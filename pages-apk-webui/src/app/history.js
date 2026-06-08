import { sanitizeImageSrc } from "./format.js";
import { getStats } from "./report-model.js";

const HISTORY_STORAGE_KEY = "apk-webui-history";
const HISTORY_COLLAPSED_STORAGE_KEY = "apk-webui-history-collapsed";
const MAX_HISTORY_ITEMS = 12;
const HISTORY_MAX_APP_ICON_DATA_URI_LENGTH = 180_000;

export function createHistoryEntry(report) {
  const compactReport = compactReportForHistory(report, { keepAppIcon: true });
  const savedAt = new Date().toISOString();

  return {
    id: createHistoryId(),
    key: buildHistoryKey(report),
    savedAt,
    summary: buildHistorySummary(compactReport),
    report: compactReport,
  };
}

export function buildHistorySummary(report) {
  const info = report.apkInfo || {};
  const sdkSummary = info.sdkSummary || {};
  const iconDataUri = sanitizeImageSrc(info.icon?.dataUri || "");

  return {
    appName: info.appName || "",
    packageName: info.packageName || "",
    versionName: info.versionName || "",
    versionCode: info.versionCode || "",
    targetSdk: info.targetSdk || "",
    fileName: report.fileName || "",
    fileSizeBytes: report.fileSizeBytes || 0,
    analyzedAt: report.analyzedAt || "",
    iconDataUri,
    sdkCount: (sdkSummary.native?.length || 0) + (sdkSummary.components?.length || 0),
    stats: getStats(info),
  };
}

function buildHistoryKey(report) {
  const info = report.apkInfo || {};
  return [
    info.packageName || "",
    info.versionCode || "",
    report.fileName || "",
    report.fileSizeBytes || "",
  ].join("::");
}

function createHistoryId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeHistoryEntry).filter(Boolean).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

export function readHistoryCollapsed() {
  try {
    return window.localStorage.getItem(HISTORY_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.report || typeof entry.report !== "object") {
    return null;
  }

  const computedSummary = buildHistorySummary(entry.report);
  const providedSummary = entry.summary && typeof entry.summary === "object" ? entry.summary : {};

  return {
    id: String(entry.id || createHistoryId()),
    key: String(entry.key || buildHistoryKey(entry.report)),
    savedAt: String(entry.savedAt || entry.report.analyzedAt || new Date().toISOString()),
    summary: {
      ...computedSummary,
      ...providedSummary,
      iconDataUri: sanitizeImageSrc(providedSummary.iconDataUri || computedSummary.iconDataUri || ""),
      stats: {
        ...computedSummary.stats,
        ...(providedSummary.stats || {}),
      },
    },
    report: entry.report,
  };
}

export function persistHistory(history) {
  const normalized = history.map(normalizeHistoryEntry).filter(Boolean).slice(0, MAX_HISTORY_ITEMS);
  const candidates = [
    normalized,
    normalized.slice(0, 8).map((entry) => compactHistoryEntry(entry, { keepAppIcon: true })),
    normalized.slice(0, 6).map((entry) => compactHistoryEntry(entry, { keepAppIcon: false })),
  ];

  for (const candidate of candidates) {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(candidate));
      return candidate;
    } catch {
      // Try a smaller representation below.
    }
  }

  return normalized;
}

function compactHistoryEntry(entry, options) {
  const report = compactReportForHistory(entry.report, options);
  const summary = buildHistorySummary(report);

  return {
    ...entry,
    summary,
    report,
  };
}

function compactReportForHistory(report, options = {}) {
  return compactHistoryValue(report, [], {
    keepAppIcon: options.keepAppIcon !== false,
  });
}

function compactHistoryValue(value, path, options) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => compactHistoryValue(entry, [...path, String(index)], options));
  }

  if (!value || typeof value !== "object") {
    if (typeof value !== "string" || !value.startsWith("data:image/")) {
      return value;
    }

    const isAppIcon = path.join(".") === "apkInfo.icon.dataUri";
    if (options.keepAppIcon && isAppIcon && value.length <= HISTORY_MAX_APP_ICON_DATA_URI_LENGTH) {
      return value;
    }

    return "";
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      compactHistoryValue(entry, [...path, key], options),
    ]),
  );
}

export function persistHistoryCollapsed(isCollapsed) {
  try {
    window.localStorage.setItem(HISTORY_COLLAPSED_STORAGE_KEY, isCollapsed ? "true" : "false");
  } catch {
    // The panel remains interactive even if the preference cannot be saved.
  }
}
