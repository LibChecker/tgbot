const ANALYTICS_ENDPOINT = "/analytics";
const SESSION_STORAGE_KEY = "apk-webui-analytics-session";
const PRIVATE_EVENT_KEYS = new Set([
  "app_icon_path",
  "chat_id",
  "error_message",
  "error_stack",
  "file_name",
  "package_name",
  "report_path",
  "url_host",
  "url_path",
]);

let readContext = () => ({});

export function initWebAnalytics(contextProvider) {
  if (typeof contextProvider === "function") {
    readContext = contextProvider;
  }

  trackWebEvent("webui.page.viewed", {
    result: "success",
    operation: "page_view",
  });
}

export function trackWebEvent(event, fields = {}) {
  if (!event || typeof window === "undefined") {
    return;
  }

  const context = readSafeContext();
  const payload = compactObject({
    ...context,
    ...fields,
    event,
    surface: "webui",
    path: window.location.pathname || "/",
    session_id: getSessionId(),
  });

  sendAnalyticsPayload(sanitizePayload(payload));
}

export function getFileAnalyticsFields(file) {
  if (!file) {
    return {};
  }

  return compactObject({
    file_extension: getFileExtension(file.name),
    size_bucket: formatSizeBucket(file.size),
  });
}

export function getReportAnalyticsFields(report) {
  const info = report?.apkInfo || {};
  const archive = info.archive || null;

  return compactObject({
    file_extension: getFileExtension(report?.fileName),
    size_bucket: formatSizeBucket(report?.fileSizeBytes),
    duration_ms: Number(report?.durationMs) || 0,
    permissions_count: countArray(info.permissions),
    native_library_count: countArray(info.nativeLibraries),
    component_count: countComponents(info.components),
    meta_data_count: countArray(info.metaData?.application),
    sdk_native_match_count: countArray(info.sdkSummary?.native),
    sdk_component_match_count: countArray(info.sdkSummary?.components),
    has_app_icon: Boolean(info.icon?.dataUri),
    archive_type: archive?.type || "apk",
    apk_entry_count:
      archive?.apkEntryCount ||
      archive?.apkEntries?.length ||
      archive?.apkEntryDetails?.length ||
      1,
  });
}

function readSafeContext() {
  try {
    return compactObject(readContext() || {});
  } catch {
    return {};
  }
}

function sendAnalyticsPayload(payload) {
  const body = JSON.stringify(payload);
  const endpoint = new URL(ANALYTICS_ENDPOINT, window.location.href).toString();

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(endpoint, blob)) {
        return;
      }
    }

    fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=UTF-8",
      },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must never affect local APK analysis.
  }
}

function sanitizePayload(payload) {
  const sanitized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (PRIVATE_EVENT_KEYS.has(key) || value == null) {
      continue;
    }

    if (typeof value === "string") {
      sanitized[key] = clipText(value, 160);
    } else if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function getSessionId() {
  try {
    const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      return saved;
    }

    const created = createRandomId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    return createRandomId();
  }
}

function createRandomId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return [...values].map((value) => value.toString(16).padStart(8, "0")).join("");
}

function getFileExtension(fileName) {
  const value = String(fileName || "").toLowerCase();
  const match = value.match(/\.([a-z0-9]+)$/u);
  return match ? match[1] : "";
}

function formatSizeBucket(value) {
  const bytes = Number(value) || 0;
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

function countComponents(components = {}) {
  return (
    countArray(components.activities) +
    countArray(components.services) +
    countArray(components.receivers) +
    countArray(components.providers)
  );
}

function countArray(value) {
  return Array.isArray(value) ? value.length : 0;
}

function clipText(value, maxLength) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function compactObject(value) {
  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null && entry !== "") {
      compacted[key] = entry;
    }
  }
  return compacted;
}
