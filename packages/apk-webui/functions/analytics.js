/** @typedef {import("../../shared/src/contracts.js").AnalyticsEventPayload} AnalyticsEventPayload */

const MAX_ANALYTICS_BODY_BYTES = 8 * 1024;

const ANALYTICS_BLOB_KEYS = [
  "event",
  "surface",
  "path",
  "result",
  "operation",
  "locale",
  "ui_mode",
  "theme_choice",
  "color_scheme",
  "file_extension",
  "size_bucket",
  "archive_type",
  "input_source",
  "tab",
  "slot",
  "source_label",
  "error_name",
  "viewport_bucket",
  "route",
  "method",
];

const ANALYTICS_DOUBLE_KEYS = [
  "duration_ms",
  "http_status",
  "permissions_count",
  "native_library_count",
  "component_count",
  "meta_data_count",
  "sdk_native_match_count",
  "sdk_component_match_count",
  "apk_entry_count",
  "total_changes_count",
  "has_app_icon",
  "history_count",
  "slot_count",
  "is_valid",
  "viewport_width",
  "viewport_height",
  "value",
  "client_time_offset_ms",
  "downloaded_bytes",
  "range_request_count",
  "reserved_1",
  "reserved_2",
];

const PRIVATE_EVENT_KEYS = new Set([
  "app_icon_path",
  "chat_id",
  "error_message",
  "error_stack",
  "file_size_bytes",
  "file_name",
  "package_name",
  "report_path",
  "url_host",
  "url_path",
]);

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
    return new Response(null, {
      status: 405,
      headers: {
        allow: "POST, OPTIONS",
        "cache-control": "no-store",
      },
    });
  }

  return handlePost(context);
}

async function handlePost({ request, env }) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_ANALYTICS_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let payload;
  try {
    const body = await request.text();
    if (body.length > MAX_ANALYTICS_BODY_BYTES) {
      return new Response(null, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }

  const event = normalizeText(payload?.event, 80);
  if (!isAnalyticsEventName(event)) {
    return new Response(null, { status: 400 });
  }

  writeAnalyticsDataPoint(env, request, {
    ...sanitizePayload(payload),
    event,
    surface: "webui",
    route: "pages_analytics",
    method: request.method,
    http_status: 204,
  });

  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
    },
  });
}

/** @param {AnalyticsEventPayload} payload */
function writeAnalyticsDataPoint(env, request, payload) {
  const dataset = env.WEBUI_ANALYTICS || env.USAGE_ANALYTICS;
  if (!dataset?.writeDataPoint) {
    return;
  }

  const normalized = normalizeAnalyticsPayload(payload);

  try {
    dataset.writeDataPoint({
      indexes: [getAnalyticsIndex(request, normalized)],
      blobs: ANALYTICS_BLOB_KEYS.map((key) => toAnalyticsBlob(normalized[key])),
      doubles: ANALYTICS_DOUBLE_KEYS.map((key) => toAnalyticsNumber(normalized[key])),
    });
  } catch (error) {
    console.warn({
      level: "warn",
      event: "webui.analytics_write_failed",
      timestamp: new Date().toISOString(),
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

function normalizeAnalyticsPayload(payload) {
  const sizeBucket = formatSizeBucket(payload.file_size_bytes);
  const viewportBucket = formatViewportBucket(payload.viewport_width);

  return compactObject({
    ...payload,
    size_bucket: payload.size_bucket || sizeBucket || undefined,
    viewport_bucket: payload.viewport_bucket || viewportBucket || undefined,
  });
}

function sanitizePayload(payload) {
  const sanitized = {};
  const sizeBucket = formatSizeBucket(payload?.file_size_bytes);
  for (const [key, value] of Object.entries(payload || {})) {
    if (PRIVATE_EVENT_KEYS.has(key) || value == null) {
      continue;
    }

    if (typeof value === "string") {
      sanitized[key] = normalizeText(value, 160);
    } else if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  if (sizeBucket && !sanitized.size_bucket) {
    sanitized.size_bucket = sizeBucket;
  }
  return compactObject(sanitized);
}

function getAnalyticsIndex(request, payload) {
  return String(
    payload.session_id ||
      request.headers.get("cf-ray") ||
      crypto.randomUUID(),
  );
}

function toAnalyticsBlob(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return normalizeText(value, 240) || "";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
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

function normalizeText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > maxLength ? text.slice(0, maxLength) : text;
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

function formatViewportBucket(value) {
  const width = toAnalyticsNumber(value);
  if (width <= 0) {
    return "";
  }
  if (width < 480) {
    return "mobile";
  }
  if (width < 900) {
    return "tablet";
  }
  return "desktop";
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  );
}

function isAnalyticsEventName(value) {
  return typeof value === "string" && value.trim().length > 0;
}
