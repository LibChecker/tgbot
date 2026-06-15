import { readApkInfoFromUrl } from "../../bot-worker/src/apk-url-preview.js";
import { assertApkReport } from "../../shared/src/contracts.js";
import { LIBCHECKER_RULES_CORE } from "../../shared/src/generated/libchecker-rules-core.js";
import { LIBCHECKER_SDK_ICON_SVGS } from "../../shared/src/generated/libchecker-sdk-icons.js";
import { normalizeLocale } from "../../shared/src/i18n.js";
import { createSdkMarkerAnnotator } from "../../shared/src/sdk-markers.js";

const MAX_BODY_BYTES = 8 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=UTF-8",
};
const DEFAULT_TERMINAL_SYSTEM = Object.freeze({
  name: "Cloudflare Pages",
  version: "",
  source: "webui-link",
});
const sdkIconDataUriCache = new Map();
const sdkRuleAnnotator = createSdkMarkerAnnotator(LIBCHECKER_RULES_CORE || []);

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        allow: "POST, OPTIONS",
        "cache-control": "no-store",
      },
    });
  }

  if (context.request.method !== "POST") {
    return jsonResponse({ error: { message: "Method not allowed" } }, 405, {
      allow: "POST, OPTIONS",
    });
  }

  return handlePost(context);
}

async function handlePost({ request, env }) {
  const startedAt = Date.now();
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    return jsonResponse({ error: { message: error.message || "Invalid request body" } }, 400);
  }

  let url;
  try {
    url = normalizeDownloadUrl(payload?.url);
  } catch (error) {
    return jsonResponse({ error: { message: error.message || "Invalid download URL" } }, 400);
  }

  try {
    const locale = normalizeLocale(payload?.locale);
    const terminalSystem = resolveAnalysisTerminalSystem();
    const preview = await readApkInfoFromUrl(url, getLinkPreviewOptions(env));
    const sdkAnnotated = sdkRuleAnnotator(preview.apkInfo, resolveSdkIconDataUri);
    const apkInfo = {
      ...preview.apkInfo,
      ...sdkAnnotated,
    };
    const report = assertApkReport({
      locale,
      terminalSystem,
      analysisProfile: buildAnalysisProfile(apkInfo, terminalSystem, preview.stats),
      durationMs: Date.now() - startedAt,
      fileName: preview.fileName || inferFallbackFileName(url),
      fileSizeBytes: preview.fileSize || 0,
      analyzedAt: new Date().toISOString(),
      apkInfo,
    });

    return jsonResponse({
      report,
      source: {
        contentLengthBytes: preview.fileSize || 0,
        contentType: preview.metadata?.contentType || "",
        supportsRange: Boolean(preview.metadata?.supportsRange),
        stats: preview.stats || {},
      },
    });
  } catch (error) {
    return jsonResponse({
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: getErrorMessage(error),
      },
    }, 422);
  }
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new Error("Request body is too large");
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error("Request body is too large");
  }

  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error("Invalid JSON request body");
  }
}

function normalizeDownloadUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP/HTTPS APK download links are supported");
  }

  url.hash = "";
  if (isBlockedHostname(url.hostname)) {
    throw new Error("This download host is not allowed");
  }

  return url.toString();
}

function isBlockedHostname(value) {
  const hostname = String(value || "").trim().toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (!hostname) {
    return true;
  }

  if (
    hostname === "localhost" ||
    hostname === "local" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return true;
  }

  if (hostname.includes(":")) {
    return (
      hostname === "::1" ||
      hostname === "0:0:0:0:0:0:0:1" ||
      hostname.startsWith("fe80:") ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd")
    );
  }

  const ipv4 = parseIpv4(hostname);
  if (!ipv4) {
    return false;
  }

  const [a, b] = ipv4;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function parseIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const values = parts.map((part) => Number(part));
  if (values.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return values;
}

function resolveAnalysisTerminalSystem() {
  return { ...DEFAULT_TERMINAL_SYSTEM };
}

function buildAnalysisProfile(apkInfo, terminalSystem, stats = {}) {
  const sdkSummary = apkInfo.sdkSummary || {};
  const nativeSdkMarkerCount = countSdkSummaryItems(sdkSummary.native);
  const componentSdkMarkerCount = countSdkSummaryItems(sdkSummary.components);

  return {
    id: "webui-http-range-apk-analyzer",
    capabilities: [
      "manifest",
      "resources",
      "native-libraries",
      "apk-signatures",
      "libchecker-sdk-rules",
      "http-range-link-preview",
    ],
    ruleCount: (LIBCHECKER_RULES_CORE || []).length,
    iconCount: Object.keys(LIBCHECKER_SDK_ICON_SVGS || {}).length,
    uniqueSdkCount: countUniqueSdkEntries(sdkSummary),
    sdkMarkerCount: nativeSdkMarkerCount + componentSdkMarkerCount,
    nativeSdkMarkerCount,
    componentSdkMarkerCount,
    runtime: {
      worker: false,
      decompressionStream: typeof DecompressionStream === "function",
      system: terminalSystem,
      rangeRequestCount: Number(stats.rangeRequestCount) || 0,
      downloadedBytes: Number(stats.downloadedBytes) || 0,
    },
  };
}

function resolveSdkIconDataUri(iconName) {
  const cacheKey = iconName || "ic_sdk_placeholder";
  if (sdkIconDataUriCache.has(cacheKey)) {
    return sdkIconDataUriCache.get(cacheKey);
  }

  const svg = LIBCHECKER_SDK_ICON_SVGS?.[iconName] || LIBCHECKER_SDK_ICON_SVGS?.ic_sdk_placeholder;
  const dataUri = svg ? `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` : "";
  sdkIconDataUriCache.set(cacheKey, dataUri);
  return dataUri;
}

function getLinkPreviewOptions(env) {
  return {
    maxCentralDirectoryBytes: parseOptionalMegabytes(env?.MAX_LINK_PREVIEW_CD_MB),
    maxEntryCompressedBytes: parseOptionalMegabytes(env?.MAX_LINK_PREVIEW_ENTRY_MB),
    maxResourceBytes: parseOptionalMegabytes(env?.MAX_LINK_PREVIEW_RESOURCE_MB),
    tailPrefetchBytes: parseOptionalMegabytes(env?.MAX_LINK_PREVIEW_TAIL_MB),
  };
}

function parseOptionalMegabytes(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed * 1024 * 1024);
}

function countSdkSummaryItems(entries = []) {
  let count = 0;
  for (const entry of entries || []) {
    count += Number(entry.count) || 0;
  }
  return count;
}

function countUniqueSdkEntries(sdkSummary = {}) {
  const keys = new Set();
  addSdkEntryKeys(keys, sdkSummary.native);
  addSdkEntryKeys(keys, sdkSummary.components);
  return keys.size;
}

function addSdkEntryKeys(keys, entries = []) {
  for (const entry of entries || []) {
    keys.add(entry.key || `${entry.label || ""}::${entry.iconName || ""}`);
  }
}

function inferFallbackFileName(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "") || `${url.hostname}.apk`;
  } catch {
    return "remote.apk";
  }
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to parse Android package from URL";
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}
