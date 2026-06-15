import { readApkInfoFromUrl } from "../../bot-worker/src/apk-url-preview.js";
import { assertApkReport } from "../../shared/src/contracts.js";
import { LIBCHECKER_RULES_CORE } from "../../shared/src/generated/libchecker-rules-core.js";
import { LIBCHECKER_SDK_ICON_SVGS } from "../../shared/src/generated/libchecker-sdk-icons.js";
import { createI18n, normalizeLocale } from "../../shared/src/i18n.js";
import { createSdkMarkerAnnotator } from "../../shared/src/sdk-markers.js";

const MAX_BODY_BYTES = 8 * 1024;
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=UTF-8",
};
const STREAM_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/x-ndjson; charset=UTF-8",
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
  const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
  let activeLocale = resolveRequestLocale(request);
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    logUrlReportEvent("warn", "url_report.bad_request", {
      request_id: requestId,
      result: "invalid_body",
      http_status: 400,
      ...getErrorTelemetryFields(error),
    });
    return jsonResponse({ error: buildErrorResponse(error, activeLocale) }, 400);
  }

  activeLocale = resolveRequestLocale(request, payload);
  let url;
  try {
    url = normalizeDownloadUrl(payload?.url);
  } catch (error) {
    logUrlReportEvent("warn", "url_report.bad_request", {
      request_id: requestId,
      result: "invalid_url",
      http_status: 400,
      ...getErrorTelemetryFields(error),
    });
    return jsonResponse({ error: buildErrorResponse(error, activeLocale) }, 400);
  }

  logUrlReportEvent("info", "url_report.accepted", {
    request_id: requestId,
    result: "accepted",
    url_host: safeUrlHost(url),
    url_path: safeUrlPath(url),
  });

  if (wantsStreamingResponse(request)) {
    return streamUrlReport({
      env,
      url,
      locale: activeLocale,
      requestId,
      startedAt,
    });
  }

  try {
    const reportPayload = await createUrlReportPayload({
      env,
      url,
      locale: activeLocale,
      requestId,
      startedAt,
    });
    return jsonResponse(reportPayload);
  } catch (error) {
    logUrlReportEvent("error", "url_report.failed", {
      request_id: requestId,
      result: "error",
      duration_ms: Date.now() - startedAt,
      url_host: safeUrlHost(url),
      url_path: safeUrlPath(url),
      ...getErrorTelemetryFields(error),
    });
    return jsonResponse({
      error: {
        name: error instanceof Error ? error.name : "Error",
        ...buildErrorResponse(error, activeLocale),
      },
    }, 422);
  }
}

async function createUrlReportPayload({ env, url, locale, requestId, startedAt, onProgress = () => {} }) {
  const terminalSystem = resolveAnalysisTerminalSystem();
  let stageStartedAt = Date.now();
  onProgress({ stage: "url_preview", progress: 0.05 });
  logUrlReportEvent("info", "url_report.preview.started", {
    request_id: requestId,
    result: "started",
    analysis_stage: "url_preview",
    url_host: safeUrlHost(url),
    url_path: safeUrlPath(url),
  });
  const preview = await readApkInfoFromUrl(url, {
    ...getLinkPreviewOptions(env),
    onProgress,
  });
  logUrlReportEvent("info", "url_report.preview.succeeded", {
    request_id: requestId,
    result: "success",
    analysis_stage: "url_preview",
    duration_ms: Date.now() - stageStartedAt,
    url_host: safeUrlHost(preview.url),
    url_path: safeUrlPath(preview.url),
    file_name: preview.fileName || null,
    content_length_bytes: preview.fileSize || 0,
    downloaded_bytes: preview.stats.downloadedBytes || 0,
    range_request_count: preview.stats.rangeRequestCount || 0,
    range_cache_hit_count: preview.stats.rangeCacheHitCount || 0,
    package_name: preview.apkInfo.packageName,
    version_name: preview.apkInfo.versionName,
    ...getPrimitiveFields(preview.diagnostics),
  });

  stageStartedAt = Date.now();
  onProgress({
    stage: "sdk_annotation",
    progress: 0.86,
    downloaded_bytes: preview.stats.downloadedBytes || 0,
    range_request_count: preview.stats.rangeRequestCount || 0,
    range_cache_hit_count: preview.stats.rangeCacheHitCount || 0,
  });
  logUrlReportEvent("info", "url_report.sdk_annotation.started", {
    request_id: requestId,
    result: "started",
    analysis_stage: "sdk_annotation",
    package_name: preview.apkInfo.packageName,
  });
  const sdkAnnotated = sdkRuleAnnotator(preview.apkInfo, resolveSdkIconDataUri);
  const apkInfo = {
    ...preview.apkInfo,
    ...sdkAnnotated,
  };
  onProgress({
    stage: "sdk_annotation",
    progress: 0.9,
    downloaded_bytes: preview.stats.downloadedBytes || 0,
    range_request_count: preview.stats.rangeRequestCount || 0,
    range_cache_hit_count: preview.stats.rangeCacheHitCount || 0,
  });
  logUrlReportEvent("info", "url_report.sdk_annotation.succeeded", {
    request_id: requestId,
    result: "success",
    analysis_stage: "sdk_annotation",
    duration_ms: Date.now() - stageStartedAt,
    package_name: apkInfo.packageName,
    sdk_native_match_count: apkInfo.sdkSummary?.native.length || 0,
    sdk_component_match_count: apkInfo.sdkSummary?.components.length || 0,
  });

  stageStartedAt = Date.now();
  onProgress({
    stage: "report_build",
    progress: 0.94,
    downloaded_bytes: preview.stats.downloadedBytes || 0,
    range_request_count: preview.stats.rangeRequestCount || 0,
    range_cache_hit_count: preview.stats.rangeCacheHitCount || 0,
  });
  logUrlReportEvent("info", "url_report.report_build.started", {
    request_id: requestId,
    result: "started",
    analysis_stage: "report_build",
    package_name: apkInfo.packageName,
  });
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
  onProgress({
    stage: "report_build",
    progress: 0.98,
    downloaded_bytes: preview.stats.downloadedBytes || 0,
    range_request_count: preview.stats.rangeRequestCount || 0,
    range_cache_hit_count: preview.stats.rangeCacheHitCount || 0,
  });
  logUrlReportEvent("info", "url_report.report_build.succeeded", {
    request_id: requestId,
    result: "success",
    analysis_stage: "report_build",
    duration_ms: Date.now() - stageStartedAt,
    package_name: apkInfo.packageName,
  });

  logUrlReportEvent("info", "url_report.succeeded", {
    request_id: requestId,
    result: "success",
    duration_ms: Date.now() - startedAt,
    url_host: safeUrlHost(preview.url),
    url_path: safeUrlPath(preview.url),
    content_length_bytes: preview.fileSize || 0,
    downloaded_bytes: preview.stats.downloadedBytes || 0,
    range_request_count: preview.stats.rangeRequestCount || 0,
    range_cache_hit_count: preview.stats.rangeCacheHitCount || 0,
    package_name: apkInfo.packageName,
    version_name: apkInfo.versionName,
    ...getPrimitiveFields(preview.diagnostics),
  });

  return {
    report,
    source: {
      contentLengthBytes: preview.fileSize || 0,
      contentType: preview.metadata?.contentType || "",
      supportsRange: Boolean(preview.metadata?.supportsRange),
      stats: preview.stats || {},
    },
  };
}

function streamUrlReport({ env, url, locale, requestId, startedAt }) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client may have closed the connection.
        }
      };

      emit({ type: "progress", stage: "accepted", progress: 0.02 });
      Promise.resolve()
        .then(async () => {
          const reportPayload = await createUrlReportPayload({
            env,
            url,
            locale,
            requestId,
            startedAt,
            onProgress: (event) => emit({ type: "progress", ...event }),
          });
          emit({ type: "result", payload: reportPayload });
        })
        .catch((error) => {
          logUrlReportEvent("error", "url_report.failed", {
            request_id: requestId,
            result: "error",
            duration_ms: Date.now() - startedAt,
            url_host: safeUrlHost(url),
            url_path: safeUrlPath(url),
            ...getErrorTelemetryFields(error),
          });
          emit({
            type: "error",
            httpStatus: 422,
            error: {
              name: error instanceof Error ? error.name : "Error",
              ...buildErrorResponse(error, locale),
            },
          });
        })
        .finally(() => {
          try {
            controller.close();
          } catch {
            // The stream may already be closed after client abort.
          }
        });
    },
  });

  return new Response(stream, {
    headers: STREAM_HEADERS,
  });
}

function wantsStreamingResponse(request) {
  return /\bapplication\/x-ndjson\b/u.test(request.headers.get("accept") || "");
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw createCodedError("Request body is too large", "request_body_too_large");
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw createCodedError("Request body is too large", "request_body_too_large");
  }

  try {
    return JSON.parse(text || "{}");
  } catch {
    throw createCodedError("Invalid JSON request body", "invalid_json_request_body");
  }
}

function normalizeDownloadUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw createCodedError("Only HTTP/HTTPS APK download links are supported", "invalid_download_url");
  }

  url.hash = "";
  if (isBlockedHostname(url.hostname)) {
    throw createCodedError("This download host is not allowed", "invalid_download_url");
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

function logUrlReportEvent(level, event, fields = {}) {
  const entry = getPrimitiveFields({
    level,
    event,
    timestamp: new Date().toISOString(),
    surface: "pages",
    route: "url_report",
    ...fields,
  });

  if (level === "error") {
    console.error(entry);
    return;
  }

  if (level === "warn") {
    console.warn(entry);
    return;
  }

  console.log(entry);
}

function getErrorTelemetryFields(error) {
  return {
    error_name: error instanceof Error ? error.name || "Error" : "UnknownError",
    error_message: getErrorMessage(error),
    error_code: getErrorCode(error),
    ...getPrimitiveFields(error?.diagnostics),
  };
}

function getErrorCode(error) {
  if (error && typeof error === "object") {
    if (typeof error.code === "string") {
      return error.code;
    }

    if (typeof error.diagnostics?.error_code === "string") {
      return error.diagnostics.error_code;
    }
  }

  return null;
}

function getPrimitiveFields(fields = {}) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value == null) {
      continue;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function safeUrlPath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function buildErrorResponse(error, locale) {
  return {
    name: error instanceof Error ? error.name || "Error" : "Error",
    message: getLocalizedErrorMessage(error, locale),
    logMessage: getErrorMessage(error),
    code: getErrorCode(error) || undefined,
    details: getErrorDetails(error),
  };
}

function getLocalizedErrorMessage(error, locale) {
  const i18n = createI18n(locale);
  const localized = getLocalizedErrorByCode(error, i18n);
  if (localized) {
    return localized;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return i18n.t("errors.unknown");
}

function getLocalizedErrorByCode(error, i18n) {
  const code = getErrorCode(error);
  if (!code || !/^[a-z0-9_]+$/u.test(code)) {
    return "";
  }

  const key = `errors.${code}`;
  const message = i18n.t(key, getErrorMessageVariables(error));
  return message === key ? "" : message;
}

function getErrorMessageVariables(error) {
  const diagnostics = error && typeof error === "object" && error.diagnostics && typeof error.diagnostics === "object"
    ? error.diagnostics
    : {};
  const selectedApkEntry = String(diagnostics.selected_apk_entry || "APK");
  const selectedApkCompression = String(diagnostics.selected_apk_compression || "unknown");

  return {
    selectedApkEntry,
    selectedApkCompression,
    selected_apk_entry: selectedApkEntry,
    selected_apk_compression: selectedApkCompression,
  };
}

function getErrorDetails(error) {
  return getPrimitiveFields(error?.diagnostics);
}

function createCodedError(message, code, diagnostics = {}) {
  const error = new Error(message);
  error.code = code;
  error.diagnostics = getPrimitiveFields({
    ...diagnostics,
    error_code: code,
  });
  return error;
}

function resolveRequestLocale(request, payload = null) {
  if (payload?.locale) {
    return normalizeLocale(payload.locale);
  }

  const acceptLanguage = request.headers.get("accept-language") || "";
  const candidate = acceptLanguage
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .find(Boolean);
  return normalizeLocale(candidate);
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
