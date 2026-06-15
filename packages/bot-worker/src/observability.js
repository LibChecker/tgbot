import { isAnalyticsEventName } from "../../shared/src/contracts.js";

/** @typedef {import("../../shared/src/contracts.js").AnalyticsEventFields} AnalyticsEventFields */

const ANALYTICS_BLOB_KEYS = [
  "event",
  "surface",
  "route",
  "method",
  "path",
  "chat_type",
  "update_type",
  "command",
  "result",
  "source_label",
  "file_extension",
  "size_bucket",
  "link_preview_mode",
  "locale",
  "archive_type",
  "worker_version_tag",
  "error_name",
  "ui_mode",
  "operation",
  "input_source",
];

const ANALYTICS_DOUBLE_KEYS = [
  "duration_ms",
  "http_status",
  "range_request_count",
  "permissions_count",
  "native_library_count",
  "component_count",
  "meta_data_count",
  "sdk_native_match_count",
  "sdk_component_match_count",
  "apk_entry_count",
  "is_forwarded",
  "bot_mentioned",
  "has_document",
  "has_apk_document",
  "has_url",
  "has_apk_url",
  "has_app_icon",
  "value",
  "reserved_1",
  "reserved_2",
];

const CONSOLE_PRIVATE_TELEMETRY_KEYS = new Set([
  "candidate_chat_id",
  "candidate_message_id",
  "chat_id",
  "error_stack",
  "from_id",
  "message_id",
  "message_thread_id",
  "webhook_url",
]);

const ANALYTICS_PRIVATE_TELEMETRY_KEYS = new Set([
  ...CONSOLE_PRIVATE_TELEMETRY_KEYS,
  "app_icon_path",
  "error_message",
  "file_name",
  "package_name",
  "report_path",
  "url_host",
  "url_path",
]);

export function createRequestTelemetryContext(request, url, env) {
  const versionMetadata = env.CF_VERSION_METADATA || {};

  return compactObject({
    surface: "worker",
    request_id: request.headers.get("cf-ray") || crypto.randomUUID(),
    ray_id: request.headers.get("cf-ray") || null,
    method: request.method,
    route: classifyRoute(url.pathname),
    path: url.pathname,
    host: url.host,
    colo: request.cf?.colo || null,
    country: request.cf?.country || null,
    worker_version_id: versionMetadata.id || null,
    worker_version_tag: versionMetadata.tag || null,
    worker_version_timestamp: versionMetadata.timestamp || null,
  });
}

/**
 * @param {Record<string, unknown>} baseContext
 * @param {AnalyticsEventFields} [extra]
 */
export function extendTelemetryContext(baseContext, extra = {}) {
  return compactObject({
    ...baseContext,
    ...extra,
  });
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} context
 * @param {string} event
 * @param {AnalyticsEventFields} [fields]
 */
export function logInfoEvent(env, context, event, fields = {}, options = {}) {
  writeTelemetry("info", env, context, event, fields, options);
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} context
 * @param {string} event
 * @param {AnalyticsEventFields} [fields]
 */
export function logWarnEvent(env, context, event, fields = {}, options = {}) {
  writeTelemetry("warn", env, context, event, fields, options);
}

/**
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown>} context
 * @param {string} event
 * @param {AnalyticsEventFields} [fields]
 */
export function logErrorEvent(env, context, event, fields = {}, options = {}) {
  writeTelemetry("error", env, context, event, fields, options);
}

function writeTelemetry(level, env, context, event, fields, options) {
  const eventName = isAnalyticsEventName(event) ? event : "telemetry.invalid_event";
  const normalizedFields = normalizeTelemetryFields(fields);
  const entry = {
    level,
    event: eventName,
    timestamp: new Date().toISOString(),
    ...context,
    ...normalizedFields,
  };

  writeConsole(level, sanitizeTelemetryEntry(entry, CONSOLE_PRIVATE_TELEMETRY_KEYS));

  if (options.analytics === false) {
    return;
  }

  writeAnalyticsDataPoint(env, context, eventName, normalizedFields);
}

function writeConsole(level, entry) {
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

function writeAnalyticsDataPoint(env, context, event, fields) {
  const dataset = env.USAGE_ANALYTICS;
  if (!dataset?.writeDataPoint) {
    return;
  }

  const merged = sanitizeTelemetryEntry({
    ...context,
    ...fields,
    event,
  }, ANALYTICS_PRIVATE_TELEMETRY_KEYS);

  try {
    dataset.writeDataPoint({
      indexes: [String(merged.request_id || crypto.randomUUID())],
      blobs: ANALYTICS_BLOB_KEYS.map((key) => toAnalyticsBlob(merged[key])),
      doubles: ANALYTICS_DOUBLE_KEYS.map((key) => toAnalyticsNumber(merged[key])),
    });
  } catch (error) {
    console.warn({
      level: "warn",
      event: "telemetry.analytics_write_failed",
      timestamp: new Date().toISOString(),
      request_id: context.request_id || null,
      original_event: event,
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

function normalizeTelemetryFields(fields) {
  const normalized = compactObject(fields);
  const fileExtension = getFileExtension(normalized.file_name);
  const sizeBucket = formatSizeBucket(
    normalized.file_size_bytes ||
      normalized.content_length_bytes ||
      normalized.downloaded_bytes,
  );

  return compactObject({
    ...normalized,
    file_extension: normalized.file_extension || fileExtension || undefined,
    size_bucket: normalized.size_bucket || sizeBucket || undefined,
  });
}

function sanitizeTelemetryEntry(entry, privateKeys) {
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => !privateKeys.has(key)),
  );
}

function getFileExtension(fileName) {
  const value = String(fileName || "").toLowerCase();
  const match = value.match(/\.([a-z0-9]+)$/u);
  return match ? match[1] : "";
}

function formatSizeBucket(value) {
  const bytes = toAnalyticsNumber(value);
  if (bytes <= 0) {
    return "";
  }

  const mb = bytes / 1024 / 1024;
  if (mb < 1) {
    return "<1MB";
  }
  if (mb < 5) {
    return "1-5MB";
  }
  if (mb < 20) {
    return "5-20MB";
  }
  if (mb < 50) {
    return "20-50MB";
  }
  if (mb < 100) {
    return "50-100MB";
  }
  return "100MB+";
}

function toAnalyticsBlob(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return clipText(value, 240);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return clipText(JSON.stringify(value), 240);
}

function toAnalyticsNumber(value) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clipText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function classifyRoute(pathname) {
  if (pathname === "/" || pathname === "/webhook") {
    return "telegram_webhook";
  }

  if (pathname === "/report") {
    return "report_viewer";
  }

  if (pathname === "/upload") {
    return "direct_upload";
  }

  if (pathname.startsWith("/icon/")) {
    return "icon_asset";
  }

  if (pathname.startsWith("/admin/")) {
    return "admin";
  }

  return "worker_route";
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}
