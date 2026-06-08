const ANALYTICS_BLOB_KEYS = [
  "event",
  "route",
  "method",
  "path",
  "chat_type",
  "chat_id",
  "update_type",
  "command",
  "result",
  "package_name",
  "file_name",
  "report_path",
  "source_label",
  "app_icon_path",
  "url_host",
  "url_path",
  "link_preview_mode",
  "worker_version_tag",
  "error_name",
  "error_message",
];

const ANALYTICS_DOUBLE_KEYS = [
  "duration_ms",
  "http_status",
  "file_size_bytes",
  "content_length_bytes",
  "downloaded_bytes",
  "range_request_count",
  "permissions_count",
  "native_library_count",
  "component_count",
  "meta_data_count",
  "sdk_native_match_count",
  "sdk_component_match_count",
  "is_forwarded",
  "is_automatic_forward",
  "bot_mentioned",
  "has_document",
  "has_apk_document",
  "has_url",
  "has_apk_url",
  "has_app_icon",
];

export function createRequestTelemetryContext(request, url, env) {
  const versionMetadata = env.CF_VERSION_METADATA || {};

  return compactObject({
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

export function extendTelemetryContext(baseContext, extra = {}) {
  return compactObject({
    ...baseContext,
    ...extra,
  });
}

export function logInfoEvent(env, context, event, fields = {}, options = {}) {
  writeTelemetry("info", env, context, event, fields, options);
}

export function logWarnEvent(env, context, event, fields = {}, options = {}) {
  writeTelemetry("warn", env, context, event, fields, options);
}

export function logErrorEvent(env, context, event, fields = {}, options = {}) {
  writeTelemetry("error", env, context, event, fields, options);
}

function writeTelemetry(level, env, context, event, fields, options) {
  const normalizedFields = compactObject(fields);
  const entry = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...context,
    ...normalizedFields,
  };

  writeConsole(level, entry);

  if (options.analytics === false) {
    return;
  }

  writeAnalyticsDataPoint(env, context, event, normalizedFields);
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

  const merged = {
    ...context,
    ...fields,
    event,
  };

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
      error_message: error instanceof Error ? error.message : "Failed to write analytics datapoint",
    });
  }
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
