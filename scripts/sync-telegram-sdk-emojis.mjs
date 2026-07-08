import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

import { SDK_ICON_CUSTOM_EMOJI_MANIFEST } from "../packages/bot-worker/src/sdk-emoji-map.js";
import { LIBCHECKER_SDK_ICON_SVGS } from "../packages/shared/src/generated/libchecker-sdk-icons.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const SET_CAPACITY = 200;
const DEFAULT_SET_BASE = "libchecker_sdk";
const DEFAULT_SET_TITLE = "LibChecker SDK Icons";
const DEFAULT_OUTPUT = "packages/bot-worker/src/sdk-emoji-map.js";
const DEFAULT_EMOJI = "🔹";

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
const outputPath = resolve(options.output || process.env.TELEGRAM_SDK_EMOJI_MAP_OUTPUT || DEFAULT_OUTPUT);

if (!dryRun && !botToken) {
  fail("Missing BOT_TOKEN. Set BOT_TOKEN or pass --bot-token=<token>.");
}

if (!dryRun && !ownerId) {
  fail("Missing owner id. Set TELEGRAM_STICKER_OWNER_ID or pass --owner-id=<telegram-user-id>.");
}

const bot = botToken ? await callTelegramJson(botToken, "getMe", {}) : { username: botUsername || "bot" };
const username = normalizeBotUsername(bot.username);
if (!username) {
  fail("Telegram bot username is required. Pass --bot-username=<username> for dry-run.");
}

const sourceIcons = getSourceIcons(LIBCHECKER_SDK_ICON_SVGS);
const manifest = normalizeManifest(SDK_ICON_CUSTOM_EMOJI_MANIFEST);
const remoteCounts = dryRun ? getManifestSetCounts(manifest) : await getRemoteSetCounts(botToken, manifest.sets);
const plan = buildSyncPlan({
  sourceIcons,
  manifest,
  botUsername: username,
  setBase,
  setTitle,
  remoteCounts,
});

printPlan(plan, { dryRun, outputPath });

if (!dryRun) {
  const updatedManifest = await executePlan(botToken, ownerId, manifest, plan);
  await writeMapFile(outputPath, updatedManifest);
  process.stdout.write(`wrote ${outputPath}\n`);
}

function buildSyncPlan({ sourceIcons, manifest, botUsername, setBase, setTitle, remoteCounts }) {
  const sets = new Map((manifest.sets || []).map((set) => [set.name, { ...set }]));
  const counts = new Map(remoteCounts);
  const actions = [];

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
    actions.push({
      type: counts.get(set.name) > 0 ? "add" : "create",
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

async function executePlan(botToken, ownerId, manifest, plan) {
  const updated = normalizeManifest(manifest);
  updated.sets = plan.sets;

  for (const action of plan.actions) {
    if (action.type === "keep") {
      updated.icons[action.icon.name] = action.current;
      continue;
    }

    const image = await renderIconPng(action.icon.svg);
    const inputSticker = buildInputSticker(action.icon.name, "sdk_icon");
    let sticker;

    if (action.type === "create") {
      await callTelegramMultipart(botToken, "createNewStickerSet", {
        user_id: ownerId,
        name: action.setName,
        title: action.setTitle,
        sticker_type: "custom_emoji",
        stickers: [inputSticker],
      }, [{ name: "sdk_icon", filename: `${action.icon.name}.png`, type: "image/png", data: image }]);
      sticker = await getStickerAt(botToken, action.setName, 0);
    } else if (action.type === "add") {
      await callTelegramMultipart(botToken, "addStickerToSet", {
        user_id: ownerId,
        name: action.setName,
        sticker: inputSticker,
      }, [{ name: "sdk_icon", filename: `${action.icon.name}.png`, type: "image/png", data: image }]);
      sticker = await getStickerAt(botToken, action.setName, -1);
    } else if (action.type === "replace") {
      const before = await callTelegramJson(botToken, "getStickerSet", { name: action.setName });
      const index = Math.max(0, before.stickers.findIndex((item) => item.file_id === action.current.stickerFileId));
      await callTelegramMultipart(botToken, "replaceStickerInSet", {
        user_id: ownerId,
        name: action.setName,
        old_sticker: action.current.stickerFileId,
        sticker: inputSticker,
      }, [{ name: "sdk_icon", filename: `${action.icon.name}.png`, type: "image/png", data: image }]);
      sticker = await getStickerAt(botToken, action.setName, index);
    }

    updated.icons[action.icon.name] = {
      setName: action.setName,
      stickerFileId: sticker.file_id,
      customEmojiId: sticker.custom_emoji_id || action.current?.customEmojiId || "",
      sha256: action.icon.sha256,
      updatedAt: new Date().toISOString(),
    };
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
    format: "static",
    emoji_list: [DEFAULT_EMOJI],
    keywords: buildKeywords(iconName),
  };
}

function buildKeywords(iconName) {
  const normalized = iconName.replace(/^ic_(lib|sdk)_/u, "").replaceAll("_", " ");
  return [normalized.slice(0, 64)].filter(Boolean);
}

async function renderIconPng(svg) {
  return sharp(Buffer.from(svg))
    .resize(100, 100, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

function getSourceIcons(svgMap) {
  return Object.entries(svgMap)
    .map(([name, svg]) => ({ name, svg, sha256: hashText(svg) }))
    .sort((left, right) => left.name.localeCompare(right.name));
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

async function getRemoteSetCounts(botToken, sets) {
  const counts = new Map();
  for (const set of sets || []) {
    try {
      const remoteSet = await callTelegramJson(botToken, "getStickerSet", { name: set.name });
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

async function writeMapFile(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderMapFile(manifest), "utf8");
}

function renderMapFile(manifest) {
  const ids = Object.fromEntries(
    Object.entries(manifest.icons)
      .filter(([, entry]) => entry?.customEmojiId)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([iconName, entry]) => [iconName, entry.customEmojiId]),
  );

  return [
    "// Generated by `npm run telegram:emoji:sync` after Telegram custom emoji sync.",
    `export const SDK_ICON_CUSTOM_EMOJI_MANIFEST = ${JSON.stringify(manifest, null, 2)};`,
    "",
    `export const SDK_ICON_CUSTOM_EMOJI_IDS = ${JSON.stringify(ids, null, 2)};`,
    "",
  ].join("\n");
}

async function callTelegramJson(botToken, method, payload) {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(payload),
  });
  return readTelegramResponse(method, response);
}

async function callTelegramMultipart(botToken, method, fields, files) {
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
}

async function readTelegramResponse(method, response) {
  const text = await response.text();
  const data = tryParseJson(text);
  if (!response.ok || !data?.ok) {
    const message = data?.description || text.trim() || `Telegram ${method} failed`;
    throw new Error(`${method} failed: ${message}`);
  }
  return data.result;
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

function printPlan(plan, { dryRun, outputPath }) {
  const summary = plan.actions.reduce((counts, action) => {
    counts[action.type] = (counts[action.type] || 0) + 1;
    return counts;
  }, {});
  process.stdout.write(`${dryRun ? "dry-run " : ""}telegram sdk emoji sync\n`);
  process.stdout.write(`${JSON.stringify({ ...summary, sets: plan.sets.length, output: outputPath }, null, 2)}\n`);
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
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
