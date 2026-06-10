import {
  compactAnalyticsObject as compactObject,
  getFileAnalyticsFields,
  getReportAnalyticsFields,
} from "./analytics-fields.js";
import { isAnalyticsEventName } from "@shared/contracts.js";

/** @typedef {import("@shared/contracts.js").AnalyticsEventFields} AnalyticsEventFields */
/** @typedef {import("@shared/contracts.js").AnalyticsEventPayload} AnalyticsEventPayload */

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

export { getFileAnalyticsFields, getReportAnalyticsFields };

export function initWebAnalytics(contextProvider) {
  if (typeof contextProvider === "function") {
    readContext = contextProvider;
  }

  trackWebEvent("webui.page.viewed", {
    result: "success",
    operation: "page_view",
  });
}

/**
 * @param {string} event
 * @param {AnalyticsEventFields} [fields]
 */
export function trackWebEvent(event, fields = {}) {
  if (!isAnalyticsEventName(event) || typeof window === "undefined") {
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

function readSafeContext() {
  try {
    return compactObject(readContext() || {});
  } catch {
    return {};
  }
}

/** @param {AnalyticsEventPayload} payload */
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

/**
 * @param {AnalyticsEventPayload}
 * @returns {AnalyticsEventPayload}
 */
function sanitizePayload(payload) {
  const sanitized = { event: payload.event };
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

function clipText(value, maxLength) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
