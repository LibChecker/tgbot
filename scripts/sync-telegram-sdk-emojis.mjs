import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { gzipSync } from "node:zlib";
import sharp from "sharp";
import svgpath from "svgpath";

import { LIBCHECKER_SDK_ICON_SVGS } from "../packages/shared/src/generated/libchecker-sdk-icons.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const SET_CAPACITY = 200;
const DEFAULT_SET_BASE = "libchecker_sdk";
const DEFAULT_SET_TITLE = "LibChecker SDK Icons";
const DEFAULT_KV_NAMESPACE_TITLE = "tgbot-sdk-emojis";
const DEFAULT_KV_KEY = "telegram-sdk-emojis:manifest:v1";
const DEFAULT_EMOJI = "🔹";
const STICKER_EMOJI_SIZE = 100;
const STICKER_SVG_DENSITY = 384;
const TGS_CANVAS_SIZE = 512;
const STICKER_RENDER_VERSION = 4;
const MONOCHROME_ICON_COLOR = "#74777F";
const DEFAULT_STICKER_FORMAT = "static";
const STICKER_FORMATS = new Set(["animated", "static"]);
const TELEGRAM_MAX_RETRIES = 8;
const TELEGRAM_RETRY_BUFFER_SECONDS = 1;

const [, , ...argv] = process.argv;
const options = parseArgs(argv);

if (options["self-test"]) {
  runSelfTest();
  process.stdout.write("sync-telegram-sdk-emojis self-test passed\n");
  process.exit(0);
}

const dryRun = getBooleanOption("dry-run") || getBooleanOption("check");
const botToken = options["bot-token"] || process.env.BOT_TOKEN;
const ownerId = options["owner-id"] || process.env.TELEGRAM_STICKER_OWNER_ID;
const botUsername = normalizeBotUsername(options["bot-username"] || process.env.TELEGRAM_BOT_USERNAME);
const setBase = normalizeSetBase(options["set-base"] || process.env.TELEGRAM_SDK_EMOJI_SET_BASE);
const setTitle = normalizeText(options["set-title"] || process.env.TELEGRAM_SDK_EMOJI_SET_TITLE) || DEFAULT_SET_TITLE;
const stickerFormat = normalizeStickerFormat(options["sticker-format"] || process.env.TELEGRAM_SDK_EMOJI_FORMAT);

if (options["render-check"]) {
  await runRenderCheck();
  process.exit(0);
}

const kvConfig = await resolveKvConfig(options, { create: !dryRun });

if (!dryRun && !botToken) {
  fail("Missing BOT_TOKEN. Set BOT_TOKEN or pass --bot-token=<token>.");
}

if (!dryRun && !ownerId) {
  fail("Missing owner id. Set TELEGRAM_STICKER_OWNER_ID or pass --owner-id=<telegram-user-id>.");
}

if (!dryRun && !kvConfig) {
  fail("Missing Cloudflare credentials. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID before syncing; the SDK emoji KV namespace is resolved or created automatically.");
}

const bot = botToken ? await callTelegramJson(botToken, "getMe", {}) : { username: botUsername || "bot" };
const username = normalizeBotUsername(bot.username);
if (!username) {
  fail("Telegram bot username is required. Pass --bot-username=<username> for dry-run.");
}

const sourceIcons = getSourceIcons(LIBCHECKER_SDK_ICON_SVGS);
const storedManifest = kvConfig ? await readKvManifest(kvConfig) : null;
const manifest = normalizeManifest(storedManifest);
const shouldReadRemoteState = Boolean(botToken);
const remoteState = shouldReadRemoteState
  ? await getRemoteSetState(botToken, manifest.sets, {
    botUsername: username,
    setBase,
    setTitle,
  })
  : {
    sets: manifest.sets,
    counts: getManifestSetCounts(manifest),
    stickersBySet: new Map(),
  };
const remoteCounts = remoteState.counts;
const refreshedManifest = shouldReadRemoteState ? refreshManifestFromRemote(manifest, sourceIcons, remoteState) : manifest;
const plan = buildSyncPlan({
  sourceIcons,
  manifest: refreshedManifest,
  remoteSetInfos: remoteState.sets,
  remoteSetStickers: remoteState.stickersBySet,
  botUsername: username,
  setBase,
  setTitle,
  remoteCounts,
});

printPlan(plan, {
  dryRun,
  kvKey: kvConfig?.key || null,
});

if (!dryRun) {
  const updatedManifest = await executePlan(botToken, ownerId, refreshedManifest, plan, {
    onUpdate: kvConfig ? async (nextManifest) => {
      await writeKvManifest(kvConfig, nextManifest);
    } : null,
  });
  if (kvConfig) {
    await writeKvManifest(kvConfig, updatedManifest);
    process.stdout.write(`wrote KV ${kvConfig.namespaceId}/${kvConfig.key}\n`);
  }
}

function refreshManifestFromRemote(manifest, sourceIcons, remoteState) {
  const refreshed = normalizeManifest(manifest);
  const remoteSets = remoteState?.sets || [];
  const stickersBySet = remoteState?.stickersBySet || new Map();
  let iconIndex = 0;

  for (const set of remoteSets) {
    const stickers = stickersBySet.get(set.name) || [];
    for (const sticker of stickers) {
      const icon = sourceIcons[iconIndex];
      iconIndex += 1;
      if (!icon) {
        break;
      }

      const previous = refreshed.icons[icon.name] || {};
      refreshed.icons[icon.name] = {
        setName: set.name,
        stickerFileId: sticker.file_id,
        customEmojiId: sticker.custom_emoji_id || previous.customEmojiId || "",
        sha256: isRemoteStickerCurrentFormat(sticker) ? icon.sha256 : previous.sha256 || "",
        updatedAt: previous.updatedAt || new Date().toISOString(),
      };
    }
  }

  refreshed.sets = summarizeSets(refreshed);
  return refreshed;
}

function isRemoteStickerCurrentFormat(sticker) {
  if (stickerFormat === "animated") {
    return Boolean(sticker?.is_animated) && !sticker?.is_video;
  }
  return !sticker?.is_animated && !sticker?.is_video;
}

function buildSyncPlan({
  sourceIcons,
  manifest,
  remoteSetInfos,
  remoteSetStickers,
  botUsername,
  setBase,
  setTitle,
  remoteCounts,
}) {
  const sets = new Map((remoteSetInfos || manifest.sets || []).map((set) => [set.name, { ...set }]));
  const counts = new Map(remoteCounts);
  const actions = [];
  const replaceCursors = new Map();

  for (const icon of sourceIcons) {
    const current = manifest.icons[icon.name];
    if (current?.customEmojiId && current.sha256 === icon.sha256) {
      actions.push({ type: "keep", icon, current });
      continue;
    }

    if (current?.stickerFileId && current.setName) {
      actions.push({ type: "replace", icon, current, setName: current.setName });
      continue;
    }

    const set = selectWritableSet({ sets, counts, botUsername, setBase, setTitle });
    const remoteStickers = remoteSetStickers?.get(set.name) || [];
    const hasRemoteSet = remoteSetStickers?.has(set.name);
    const replaceCursor = replaceCursors.get(set.name) || 0;
    if (replaceCursor < remoteStickers.length) {
      const sticker = remoteStickers[replaceCursor];
      actions.push({
        type: "replace",
        icon,
        setName: set.name,
        setTitle: set.title,
        current: {
          setName: set.name,
          stickerFileId: sticker.file_id,
          customEmojiId: sticker.custom_emoji_id || "",
        },
      });
      replaceCursors.set(set.name, replaceCursor + 1);
      continue;
    }

    actions.push({
      type: counts.get(set.name) > 0 || hasRemoteSet ? "add" : "create",
      icon,
      setName: set.name,
      setTitle: set.title,
    });
    counts.set(set.name, (counts.get(set.name) || 0) + 1);
  }

  return { actions, sets: [...sets.values()] };
}

function selectWritableSet({ sets, counts, botUsername, setBase, setTitle }) {
  for (const set of sets.values()) {
    if ((counts.get(set.name) || 0) < SET_CAPACITY) {
      return set;
    }
  }

  const set = {
    name: buildSetName(setBase, botUsername, sets.size + 1),
    title: sets.size === 0 ? setTitle : `${setTitle} ${sets.size + 1}`,
  };
  sets.set(set.name, set);
  counts.set(set.name, 0);
  return set;
}

async function executePlan(botToken, ownerId, manifest, plan, { onUpdate } = {}) {
  const updated = normalizeManifest(manifest);
  updated.sets = plan.sets;

  for (const action of plan.actions) {
    if (action.type === "keep") {
      updated.icons[action.icon.name] = action.current;
      continue;
    }

    const stickerFile = await renderStickerFile(action.icon);
    const inputSticker = buildInputSticker(action.icon.name, stickerFile.name);
    let sticker;

    if (action.type === "create") {
      await callTelegramMultipart(botToken, "createNewStickerSet", {
        user_id: ownerId,
        name: action.setName,
        title: action.setTitle,
        sticker_type: "custom_emoji",
        stickers: [inputSticker],
      }, [stickerFile]);
      sticker = await getStickerAt(botToken, action.setName, 0);
    } else if (action.type === "add") {
      await callTelegramMultipart(botToken, "addStickerToSet", {
        user_id: ownerId,
        name: action.setName,
        sticker: inputSticker,
      }, [stickerFile]);
      sticker = await getStickerAt(botToken, action.setName, -1);
    } else if (action.type === "replace") {
      const before = await callTelegramJson(botToken, "getStickerSet", { name: action.setName });
      const index = Math.max(0, before.stickers.findIndex((item) => item.file_id === action.current.stickerFileId));
      await callTelegramMultipart(botToken, "replaceStickerInSet", {
        user_id: ownerId,
        name: action.setName,
        old_sticker: action.current.stickerFileId,
        sticker: inputSticker,
      }, [stickerFile]);
      sticker = await getStickerAt(botToken, action.setName, index);
    }

    updated.icons[action.icon.name] = {
      setName: action.setName,
      stickerFileId: sticker.file_id,
      customEmojiId: sticker.custom_emoji_id || action.current?.customEmojiId || "",
      sha256: action.icon.sha256,
      updatedAt: new Date().toISOString(),
    };
    updated.sets = summarizeSets(updated);
    if (onUpdate) {
      await onUpdate(updated);
    }
  }

  updated.sets = summarizeSets(updated);
  return updated;
}

async function getStickerAt(botToken, setName, index) {
  const set = await callTelegramJson(botToken, "getStickerSet", { name: setName });
  const stickers = set.stickers || [];
  const sticker = stickers[index < 0 ? stickers.length + index : index];
  if (!sticker) {
    fail(`Sticker set ${setName} did not contain the expected sticker.`);
  }
  return sticker;
}

function buildInputSticker(iconName, attachName) {
  return {
    sticker: `attach://${attachName}`,
    format: stickerFormat,
    emoji_list: [DEFAULT_EMOJI],
    keywords: buildKeywords(iconName),
  };
}

function buildKeywords(iconName) {
  const normalized = iconName.replace(/^ic_(lib|sdk)_/u, "").replaceAll("_", " ");
  return [normalized.slice(0, 64)].filter(Boolean);
}

async function renderStickerFile(icon) {
  if (stickerFormat === "static") {
    return {
      name: "sdk_icon",
      filename: `${icon.name}.png`,
      type: "image/png",
      data: await renderIconPng(icon.svg),
    };
  }

  return {
    name: "sdk_icon",
    filename: `${icon.name}.tgs`,
    type: "application/x-tgsticker",
    data: renderIconTgs(icon.svg, icon.name),
  };
}

async function renderIconPng(svg) {
  return sharp(Buffer.from(svg), { density: STICKER_SVG_DENSITY })
    .resize(STICKER_EMOJI_SIZE, STICKER_EMOJI_SIZE, {
      fit: "contain",
      kernel: "lanczos3",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function renderIconTgs(svg, name) {
  const lottie = buildLottieFromSvg(svg, name);
  const data = gzipSync(Buffer.from(JSON.stringify(lottie)), { level: 9 });
  if (data.length > 64 * 1024) {
    fail(`Unable to convert ${name} to TGS: ${data.length} bytes exceeds Telegram's 64 KB animated sticker limit.`);
  }
  return data;
}

function buildLottieFromSvg(svg, name) {
  const viewBox = parseViewBox(svg);
  const scale = Math.min(TGS_CANVAS_SIZE / viewBox.width, TGS_CANVAS_SIZE / viewBox.height);
  const translateX = (TGS_CANVAS_SIZE - viewBox.width * scale) / 2 - viewBox.x * scale;
  const translateY = (TGS_CANVAS_SIZE - viewBox.height * scale) / 2 - viewBox.y * scale;
  const gradients = parseSvgGradients(svg);
  const visibleSvg = stripSvgDefinitions(svg);
  const shapes = [];

  for (const match of visibleSvg.matchAll(/<path\b([^>]*)\/?>/gu)) {
    const attrs = parseSvgAttributes(match[1]);
    const pathData = attrs.d;
    if (!pathData) {
      continue;
    }
    const paths = pathDataToLottieShapes(pathData, { scale, translateX, translateY });
    if (paths.length === 0) {
      continue;
    }
    const fill = resolveSvgPaint(attrs.fill, gradients);
    const stroke = resolveSvgPaint(attrs.stroke, gradients);
    const items = paths.map((path) => ({ ty: "sh", ks: { a: 0, k: path }, nm: "Path", hd: false }));
    if (fill) {
      items.push(buildLottieFill(fill, attrs));
    }
    if (stroke) {
      items.push(buildLottieStroke(stroke, attrs, scale));
    }
    items.push({
      ty: "tr",
      p: { a: 0, k: [0, 0] },
      a: { a: 0, k: [0, 0] },
      s: { a: 0, k: [100, 100] },
      r: { a: 0, k: 0 },
      o: { a: 0, k: 100 },
      sk: { a: 0, k: 0 },
      sa: { a: 0, k: 0 },
      nm: "Transform",
    });
    shapes.push({ ty: "gr", it: items, nm: "Path Group", hd: false });
  }

  if (shapes.length === 0) {
    fail(`Unable to convert ${name} to TGS: no supported vector paths.`);
  }

  return {
    v: "5.7.4",
    fr: 60,
    ip: 0,
    op: 60,
    w: TGS_CANVAS_SIZE,
    h: TGS_CANVAS_SIZE,
    nm: name,
    ddd: 0,
    assets: [],
    layers: [{
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: name,
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [0, 0, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0,
      shapes,
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
    }],
  };
}

function pathDataToLottieShapes(pathData, transform) {
  const paths = [];
  let path = null;
  let current = [0, 0];
  let start = [0, 0];

  const closePath = () => {
    if (path?.v.length > 1) {
      paths.push(path);
    }
    path = null;
  };

  const startPath = (x, y) => {
    closePath();
    const point = transformPoint(x, y, transform);
    path = { i: [[0, 0]], o: [[0, 0]], v: [point], c: false };
    current = [x, y];
    start = [x, y];
  };

  const addLine = (x, y) => {
    if (!path) {
      startPath(x, y);
      return;
    }
    path.v.push(transformPoint(x, y, transform));
    path.i.push([0, 0]);
    path.o.push([0, 0]);
    current = [x, y];
  };

  const addCubic = (x1, y1, x2, y2, x, y) => {
    if (!path) {
      startPath(current[0], current[1]);
    }
    const previous = path.v[path.v.length - 1];
    const control1 = transformPoint(x1, y1, transform);
    const control2 = transformPoint(x2, y2, transform);
    const end = transformPoint(x, y, transform);
    path.o[path.o.length - 1] = [control1[0] - previous[0], control1[1] - previous[1]];
    path.v.push(end);
    path.i.push([control2[0] - end[0], control2[1] - end[1]]);
    path.o.push([0, 0]);
    current = [x, y];
  };

  svgpath(pathData).abs().unarc().unshort().iterate((segment) => {
    const command = segment[0];
    if (command === "M") {
      startPath(segment[1], segment[2]);
    } else if (command === "L") {
      addLine(segment[1], segment[2]);
    } else if (command === "H") {
      addLine(segment[1], current[1]);
    } else if (command === "V") {
      addLine(current[0], segment[1]);
    } else if (command === "C") {
      addCubic(segment[1], segment[2], segment[3], segment[4], segment[5], segment[6]);
    } else if (command === "Q") {
      const [x0, y0] = current;
      const [, x1, y1, x, y] = segment;
      addCubic(
        x0 + (2 / 3) * (x1 - x0),
        y0 + (2 / 3) * (y1 - y0),
        x + (2 / 3) * (x1 - x),
        y + (2 / 3) * (y1 - y),
        x,
        y,
      );
    } else if (command === "Z") {
      if (path) {
        path.c = true;
        current = start;
      }
    }
  });
  closePath();
  return paths;
}

function transformPoint(x, y, { scale, translateX, translateY }) {
  return [
    roundLottieNumber(x * scale + translateX),
    roundLottieNumber(y * scale + translateY),
  ];
}

function buildLottieFill(color, attrs) {
  return {
    ty: "fl",
    c: { a: 0, k: colorToLottie(color) },
    o: { a: 0, k: opacityToPercent(attrs["fill-opacity"]) },
    r: attrs["fill-rule"] === "evenodd" ? 2 : 1,
    bm: 0,
    nm: "Fill",
    hd: false,
  };
}

function buildLottieStroke(color, attrs, scale) {
  return {
    ty: "st",
    c: { a: 0, k: colorToLottie(color) },
    o: { a: 0, k: opacityToPercent(attrs["stroke-opacity"]) },
    w: { a: 0, k: roundLottieNumber(toNumber(attrs["stroke-width"], 1) * scale) },
    lc: lineCapToLottie(attrs["stroke-linecap"]),
    lj: lineJoinToLottie(attrs["stroke-linejoin"]),
    ml: 4,
    bm: 0,
    nm: "Stroke",
    hd: false,
  };
}

function getSourceIcons(svgMap) {
  return Object.entries(svgMap)
    .map(([name, svg]) => {
      const stickerSvg = normalizeStickerSvg(svg);
      return {
        name,
        svg: stickerSvg,
        sha256: hashText(`${STICKER_RENDER_VERSION}:${stickerFormat}\n${stickerSvg}`),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseViewBox(svg) {
  const match = svg.match(/\bviewBox="([^"]+)"/u);
  const values = match?.[1]?.trim().split(/[\s,]+/u).map(Number) || [];
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
    return { x: 0, y: 0, width: STICKER_EMOJI_SIZE, height: STICKER_EMOJI_SIZE };
  }
  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

function parseSvgAttributes(text) {
  const attrs = {};
  for (const match of text.matchAll(/\s([a-zA-Z_:][-:\w.]*)="([^"]*)"/gu)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function stripSvgDefinitions(svg) {
  return String(svg || "").replace(/<defs\b[\s\S]*?<\/defs>/gu, "");
}

function parseSvgGradients(svg) {
  const gradients = new Map();
  const pattern = /<(linearGradient|radialGradient)\b([^>]*)>([\s\S]*?)<\/\1>/gu;
  for (const match of svg.matchAll(pattern)) {
    const attrs = parseSvgAttributes(match[2]);
    const stop = match[3].match(/<stop\b([^>]*)\/?>/u);
    if (!attrs.id || !stop) {
      continue;
    }
    const stopAttrs = parseSvgAttributes(stop[1]);
    const color = normalizeCssColor(stopAttrs["stop-color"]);
    if (color) {
      gradients.set(attrs.id, color);
    }
  }
  return gradients;
}

function resolveSvgPaint(value, gradients) {
  const paint = String(value || "").trim();
  const gradient = paint.match(/^url\(#([^)]+)\)$/u);
  if (gradient) {
    return gradients.get(gradient[1]) || "";
  }
  return normalizeCssColor(paint);
}

function colorToLottie(color) {
  const rgb = parseHexColor(color) || { r: 0, g: 0, b: 0 };
  return [
    roundLottieNumber(rgb.r / 255),
    roundLottieNumber(rgb.g / 255),
    roundLottieNumber(rgb.b / 255),
    1,
  ];
}

function opacityToPercent(value) {
  return roundLottieNumber(Math.max(0, Math.min(1, toNumber(value, 1))) * 100);
}

function lineCapToLottie(value) {
  if (value === "round") {
    return 2;
  }
  if (value === "square") {
    return 3;
  }
  return 1;
}

function lineJoinToLottie(value) {
  if (value === "round") {
    return 2;
  }
  if (value === "bevel") {
    return 3;
  }
  return 1;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundLottieNumber(value) {
  return Math.round(value * 1000) / 1000;
}

function normalizeStickerSvg(svg) {
  return isNeutralMonochromeSvg(svg) ? recolorNeutralSvg(svg, MONOCHROME_ICON_COLOR) : svg;
}

function isNeutralMonochromeSvg(svg) {
  const colors = getSvgPaintColors(svg);
  return colors.length === 1 && isNeutralColor(colors[0]);
}

function getSvgPaintColors(svg) {
  const colors = new Set();
  const paintPattern = /\b(?:fill|stroke)="([^"]+)"/gu;
  for (const match of svg.matchAll(paintPattern)) {
    const color = normalizeCssColor(match[1]);
    if (color) {
      colors.add(color);
    }
  }
  return [...colors];
}

function recolorNeutralSvg(svg, color) {
  return svg.replace(/\b(fill|stroke)="([^"]+)"/gu, (match, attr, value) => {
    const normalized = normalizeCssColor(value);
    return normalized && isNeutralColor(normalized) ? `${attr}="${color}"` : match;
  });
}

function normalizeCssColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (!color || color === "none" || color === "transparent" || color.startsWith("url(")) {
    return "";
  }
  if (color === "black") {
    return "#000000";
  }
  if (color === "white") {
    return "#ffffff";
  }
  if (/^#[0-9a-f]{3}$/u.test(color)) {
    return `#${[...color.slice(1)].map((item) => item + item).join("")}`;
  }
  if (/^#[0-9a-f]{6}$/u.test(color)) {
    return color;
  }
  const rgb = color.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/u);
  if (!rgb) {
    return "";
  }
  return `#${rgb.slice(1).map((item) => clampColor(Number(item)).toString(16).padStart(2, "0")).join("")}`;
}

function isNeutralColor(color) {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return false;
  }
  return Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) <= 8;
}

function parseHexColor(color) {
  const match = String(color || "").match(/^#([0-9a-f]{6})$/iu);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Number.isFinite(value) ? value : 0));
}

function normalizeManifest(value) {
  return {
    version: 1,
    sets: Array.isArray(value?.sets) ? value.sets.map((set) => ({ ...set })) : [],
    icons: value?.icons && typeof value.icons === "object" ? { ...value.icons } : {},
  };
}

function getManifestSetCounts(manifest) {
  const counts = new Map((manifest.sets || []).map((set) => [set.name, 0]));
  for (const entry of Object.values(manifest.icons || {})) {
    if (entry?.setName) {
      counts.set(entry.setName, (counts.get(entry.setName) || 0) + 1);
    }
  }
  return counts;
}

async function getRemoteSetState(botToken, sets, { botUsername, setBase, setTitle }) {
  const remoteSetInfos = (sets || []).map((set) => ({ ...set }));
  const stickersBySet = new Map();
  const counts = new Map();
  for (const set of remoteSetInfos) {
    const remoteSet = await tryGetRemoteSet(botToken, set.name);
    if (!remoteSet) {
      counts.set(set.name, 0);
      continue;
    }
    counts.set(set.name, remoteSet.stickers?.length || 0);
    stickersBySet.set(set.name, remoteSet.stickers || []);
  }

  if ((sets || []).length > 0) {
    return {
      sets: remoteSetInfos,
      counts,
      stickersBySet,
    };
  }

  for (let index = 1; index <= 9999; index += 1) {
    const setName = buildSetName(setBase, botUsername, index);
    const remoteSet = await tryGetRemoteSet(botToken, setName);
    if (!remoteSet) {
      break;
    }
    remoteSetInfos.push({
      name: setName,
      title: index === 1 ? setTitle : `${setTitle} ${index}`,
      count: remoteSet.stickers?.length || 0,
    });
    counts.set(setName, remoteSet.stickers?.length || 0);
    stickersBySet.set(setName, remoteSet.stickers || []);
  }

  return {
    sets: remoteSetInfos,
    counts,
    stickersBySet,
  };
}

async function tryGetRemoteSet(botToken, setName) {
  try {
    return await callTelegramJson(botToken, "getStickerSet", { name: setName });
  } catch {
    return null;
  }
}

async function getRemoteSetCounts(botToken, sets) {
  const counts = new Map();
  for (const set of sets || []) {
    try {
      const remoteSet = await tryGetRemoteSet(botToken, set.name);
      if (!remoteSet) {
        counts.set(set.name, 0);
        continue;
      }
      counts.set(set.name, remoteSet.stickers?.length || 0);
    } catch {
      counts.set(set.name, 0);
    }
  }
  return counts;
}

function summarizeSets(manifest) {
  const counts = getManifestSetCounts(manifest);
  const known = new Map((manifest.sets || []).map((set) => [set.name, { ...set, count: counts.get(set.name) || 0 }]));
  for (const setName of counts.keys()) {
    if (!known.has(setName)) {
      known.set(setName, { name: setName, title: setName, count: counts.get(setName) || 0 });
    }
  }
  return [...known.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function readKvManifest(config) {
  const response = await cloudflareKvRequest(config, {
    method: "GET",
  });
  if (response.status === 404) {
    return null;
  }

  const text = await response.text();
  if (!response.ok) {
    fail(`Cloudflare KV read failed: ${formatHttpError(response, text)}`);
  }

  const payload = tryParseJson(text);
  if (!payload) {
    fail(`Cloudflare KV key ${config.key} did not contain valid JSON.`);
  }
  return normalizeStoredManifest(payload);
}

async function writeKvManifest(config, manifest) {
  const response = await cloudflareKvRequest(config, {
    method: "PUT",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(renderKvManifestPayload(manifest)),
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`Cloudflare KV write failed: ${formatHttpError(response, text)}`);
  }
}

function normalizeStoredManifest(value) {
  if (value?.manifest && typeof value.manifest === "object") {
    return normalizeManifest(value.manifest);
  }
  return normalizeManifest(value);
}

function renderKvManifestPayload(manifest) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    ids: getCustomEmojiIds(manifest),
    manifest,
  };
}

function getCustomEmojiIds(manifest) {
  return Object.fromEntries(
    Object.entries(manifest.icons || {})
      .filter(([, entry]) => entry?.customEmojiId)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([iconName, entry]) => [iconName, entry.customEmojiId]),
  );
}

async function cloudflareKvRequest(config, options = {}) {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/storage/kv/namespaces/${encodeURIComponent(config.namespaceId)}/values/${encodeURIComponent(config.key)}`,
    {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        ...(options.headers || {}),
      },
      body: options.body,
    },
  );
}

async function resolveCloudflareKvNamespaceId(config) {
  const existingNamespaceId = await findCloudflareKvNamespaceId(config);
  if (existingNamespaceId) {
    return existingNamespaceId;
  }
  if (!config.create) {
    return "";
  }

  const namespace = await cloudflareApiJson(config, "/storage/kv/namespaces", {
    method: "POST",
    body: JSON.stringify({ title: config.title }),
  });
  const namespaceId = normalizeText(namespace?.id);
  if (!namespaceId) {
    fail(`Cloudflare KV namespace ${config.title} was created without an id in the API response.`);
  }
  process.stdout.write(`Created Cloudflare KV namespace: ${config.title} (${namespaceId})\n`);
  return namespaceId;
}

async function findCloudflareKvNamespaceId(config) {
  for (let page = 1; page <= 100; page += 1) {
    const namespaces = await cloudflareApiJson(
      config,
      `/storage/kv/namespaces?per_page=100&page=${page}`,
    );
    const match = (namespaces || []).find((namespace) => namespace?.title === config.title);
    if (match?.id) {
      return match.id;
    }
    if (!Array.isArray(namespaces) || namespaces.length < 100) {
      break;
    }
  }
  return "";
}

async function cloudflareApiJson(config, pathname, options = {}) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}${pathname}`,
    {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        ...(options.body ? { "content-type": "application/json; charset=UTF-8" } : {}),
        ...(options.headers || {}),
      },
      body: options.body,
    },
  );
  const text = await response.text();
  const data = tryParseJson(text);
  if (!response.ok || !data?.success) {
    fail(`Cloudflare API request failed: ${formatHttpError(response, text)}`);
  }
  return data.result;
}

async function callTelegramJson(botToken, method, payload) {
  return callTelegramWithRetry(method, async () => {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify(payload),
    });
    return readTelegramResponse(method, response);
  });
}

async function callTelegramMultipart(botToken, method, fields, files) {
  return callTelegramWithRetry(method, async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      form.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    for (const file of files) {
      form.set(file.name, new Blob([file.data], { type: file.type }), file.filename);
    }

    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: "POST",
      body: form,
    });
    return readTelegramResponse(method, response);
  });
}

async function callTelegramWithRetry(method, request) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      const retryAfter = getTelegramRetryAfter(error);
      if (!retryAfter || attempt >= TELEGRAM_MAX_RETRIES) {
        throw error;
      }

      const waitSeconds = retryAfter + TELEGRAM_RETRY_BUFFER_SECONDS;
      process.stderr.write(`${method} rate limited; retrying in ${waitSeconds}s\n`);
      await delay(waitSeconds * 1000);
    }
  }
}

async function readTelegramResponse(method, response) {
  const text = await response.text();
  const data = tryParseJson(text);
  if (!response.ok || !data?.ok) {
    const message = data?.description || text.trim() || `Telegram ${method} failed`;
    throw createTelegramApiError(method, message, {
      status: response.status,
      retryAfter: Number(data?.parameters?.retry_after) || 0,
    });
  }
  return data.result;
}

function getTelegramRetryAfter(error) {
  const retryAfter = Number(error?.retryAfter) || 0;
  return error?.name === "TelegramApiError" && retryAfter > 0 ? retryAfter : 0;
}

function createTelegramApiError(method, message, { status, retryAfter }) {
  const error = new Error(`${method} failed: ${message}`);
  error.name = "TelegramApiError";
  error.method = method;
  error.status = status;
  error.retryAfter = retryAfter;
  return error;
}

function buildSetName(base, botUsername, index) {
  const suffix = `_by_${botUsername}`;
  const nameBase = index <= 1 ? base : `${base}_${index}`;
  const maxBaseLength = 64 - suffix.length;
  return `${nameBase.slice(0, maxBaseLength).replace(/_+$/u, "")}${suffix}`;
}

function normalizeSetBase(value) {
  const normalized = normalizeText(value || DEFAULT_SET_BASE)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]/gu, "_")
    .replaceAll(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return /^[a-z]/u.test(normalized) ? normalized : DEFAULT_SET_BASE;
}

function normalizeStickerFormat(value) {
  const normalized = normalizeText(value || DEFAULT_STICKER_FORMAT).toLowerCase();
  return STICKER_FORMATS.has(normalized) ? normalized : DEFAULT_STICKER_FORMAT;
}

async function resolveKvConfig(parsedOptions, { create }) {
  const namespaceId = normalizeText(parsedOptions["kv-namespace-id"] || process.env.TELEGRAM_SDK_EMOJI_KV_NAMESPACE_ID);
  const namespaceTitle = normalizeText(
    parsedOptions["kv-namespace-title"]
      || parsedOptions["kv-namespace-name"]
      || process.env.TELEGRAM_SDK_EMOJI_KV_NAMESPACE_TITLE
      || process.env.TELEGRAM_SDK_EMOJI_KV_NAMESPACE_NAME,
  ) || DEFAULT_KV_NAMESPACE_TITLE;
  const accountId = normalizeText(parsedOptions["cloudflare-account-id"] || process.env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = normalizeText(parsedOptions["cloudflare-api-token"] || process.env.CLOUDFLARE_API_TOKEN);
  const key = normalizeText(parsedOptions["kv-key"] || process.env.TELEGRAM_SDK_EMOJI_KV_KEY) || DEFAULT_KV_KEY;
  const hasCloudflareCredentials = Boolean(accountId && apiToken);
  if (!namespaceId && !hasCloudflareCredentials) {
    if (accountId || apiToken) {
      fail("Missing Cloudflare KV environment: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN");
    }
    return null;
  }

  const missingCredentials = [
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
    ["CLOUDFLARE_API_TOKEN", apiToken],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missingCredentials.length > 0) {
    fail(`Missing Cloudflare KV environment: ${missingCredentials.join(", ")}`);
  }

  if (namespaceId) {
    return { namespaceId, namespaceTitle, accountId, apiToken, key };
  }

  const resolvedNamespaceId = await resolveCloudflareKvNamespaceId({
    accountId,
    apiToken,
    title: namespaceTitle,
    create,
  });
  if (!resolvedNamespaceId) {
    return null;
  }

  return { namespaceId: resolvedNamespaceId, namespaceTitle, accountId, apiToken, key };
}

function normalizeBotUsername(value) {
  return normalizeText(value)?.replace(/^@/u, "").toLowerCase() || "";
}

function normalizeText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "";
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function printPlan(plan, { dryRun, kvKey }) {
  const summary = plan.actions.reduce((counts, action) => {
    counts[action.type] = (counts[action.type] || 0) + 1;
    return counts;
  }, {});
  process.stdout.write(`${dryRun ? "dry-run " : ""}telegram sdk emoji sync\n`);
  process.stdout.write(`${JSON.stringify({ ...summary, sets: plan.sets.length, kvKey }, null, 2)}\n`);
}

async function runRenderCheck() {
  const icons = getSourceIcons(LIBCHECKER_SDK_ICON_SVGS);
  const sizes = [];
  for (const icon of icons) {
    const file = await renderStickerFile(icon);
    sizes.push({ name: icon.name, size: file.data.length });
  }
  sizes.sort((left, right) => right.size - left.size);
  process.stdout.write(`${stickerFormat} sticker render check\n`);
  process.stdout.write(`${JSON.stringify({
    count: sizes.length,
    max: sizes[0],
    largest: sizes.slice(0, 5),
  }, null, 2)}\n`);
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const equalIndex = key.indexOf("=");
    if (equalIndex >= 0) {
      result[key.slice(0, equalIndex)] = key.slice(equalIndex + 1);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
      continue;
    }

    result[key] = next;
    index += 1;
  }
  return result;
}

function getBooleanOption(name) {
  const raw = options[name];
  if (raw == null) {
    return false;
  }
  return ["1", "true", "yes"].includes(String(raw).toLowerCase());
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatHttpError(response, text) {
  const data = tryParseJson(text);
  const message = data?.errors?.map((error) => error.message).filter(Boolean).join("; ")
    || data?.message
    || text.trim()
    || `HTTP ${response.status}`;
  return `HTTP ${response.status}: ${message}`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runSelfTest() {
  const sourceIcons = Array.from({ length: 201 }, (_, index) => ({
    name: `ic_lib_test_${String(index).padStart(3, "0")}`,
    svg: "<svg />",
    sha256: String(index),
  }));
  const plan = buildSyncPlan({
    sourceIcons,
    manifest: normalizeManifest({}),
    botUsername: "examplebot",
    setBase: "libchecker_sdk",
    setTitle: "LibChecker SDK Icons",
    remoteCounts: new Map(),
  });

  assert(plan.sets.length === 2, "rollover creates a second sticker set");
  assert(plan.actions.filter((action) => action.type === "create").length === 2, "first sticker in each set creates it");
  assert(plan.actions.filter((action) => action.type === "add").length === 199, "remaining stickers are appended");

  assert(
    normalizeStickerSvg('<svg><path fill="#000000" d="M0,0" /></svg>').includes(`fill="${MONOCHROME_ICON_COLOR}"`),
    "neutral monochrome icons are recolored",
  );
  assert(
    normalizeStickerSvg('<svg><path fill="#ff0000" d="M0,0" /></svg>').includes('fill="#ff0000"'),
    "single brand-color icons keep their color",
  );
  assert(
    normalizeStickerSvg('<svg><path fill="#000000" d="M0,0" /><path fill="#ffffff" d="M1,1" /></svg>').includes('fill="#000000"'),
    "two-tone neutral icons keep their contrast",
  );
  const vector = renderIconTgs('<svg viewBox="0 0 24 24"><path fill="#000000" d="M4,4L20,4L20,20L4,20Z" /></svg>', "test");
  assert(vector[0] === 0x1f && vector[1] === 0x8b, "TGS output is gzip-compressed Lottie");
  assert(vector.length < 64 * 1024, "TGS output stays inside Telegram animated sticker limit");

  const clipped = buildLottieFromSvg('<svg viewBox="0 0 24 24"><defs><clipPath id="c"><path d="M0,0H24V24H0Z" /></clipPath></defs><path fill="#000000" d="M4,4H20V20H4Z" /></svg>', "clip-test");
  assert(clipped.layers[0].shapes.length === 1, "clipPath definition paths are not rendered as visible sticker paths");

  const compound = buildLottieFromSvg('<svg viewBox="0 0 24 24"><path fill="#000000" fill-rule="evenodd" d="M2,2H22V22H2Z M8,8H16V16H8Z" /></svg>', "compound-test");
  const items = compound.layers[0].shapes[0].it;
  assert(items.filter((item) => item.ty === "sh").length === 2, "compound path subpaths stay in one fill group");
  assert(items.filter((item) => item.ty === "fl").length === 1, "compound path uses one shared fill");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
