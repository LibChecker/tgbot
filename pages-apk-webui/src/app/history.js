import { sanitizeImageSrc } from "./format.js";
import { getStats } from "./report-model.js";

const HISTORY_STORAGE_KEY = "apk-webui-history";
const HISTORY_COLLAPSED_STORAGE_KEY = "apk-webui-history-collapsed";
const MAX_HISTORY_ITEMS = 12;
const HISTORY_MAX_APP_ICON_DATA_URI_LENGTH = 180_000;
const COMPACT_SKIP = Symbol("compact-skip");
const HISTORY_PATH_ROOT = 0;
const HISTORY_PATH_OTHER = -1;
const HISTORY_PATH_APK_INFO = 1;
const HISTORY_PATH_APK_ICON = 2;
const HISTORY_PATH_APK_ICON_DATA_URI = 3;

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

    return normalizeHistoryList(parsed, MAX_HISTORY_ITEMS);
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

  const report = compactReportForHistory(entry.report, { keepAppIcon: true });
  const computedSummary = buildHistorySummary(report);
  const providedSummary = entry.summary && typeof entry.summary === "object" ? entry.summary : {};

  return {
    id: String(entry.id || createHistoryId()),
    key: String(entry.key || buildHistoryKey(report)),
    savedAt: String(entry.savedAt || report.analyzedAt || new Date().toISOString()),
    summary: {
      ...computedSummary,
      ...providedSummary,
      iconDataUri: sanitizeImageSrc(providedSummary.iconDataUri || computedSummary.iconDataUri || ""),
      stats: {
        ...computedSummary.stats,
        ...(providedSummary.stats || {}),
      },
    },
    report,
  };
}

export function persistHistory(history, options = {}) {
  const normalized = options.normalized === true
    ? history.slice(0, MAX_HISTORY_ITEMS)
    : normalizeHistoryList(history, MAX_HISTORY_ITEMS);
  if (tryPersistHistoryCandidate(normalized)) {
    return normalized;
  }

  const compactWithIcons = compactHistoryEntries(normalized, 8, { keepAppIcon: true });
  if (tryPersistHistoryCandidate(compactWithIcons)) {
    return compactWithIcons;
  }

  const compactWithoutIcons = compactHistoryEntries(normalized, 6, { keepAppIcon: false });
  if (tryPersistHistoryCandidate(compactWithoutIcons)) {
    return compactWithoutIcons;
  }

  return normalized;
}

function normalizeHistoryList(history, limit) {
  const normalized = [];
  for (const entry of history) {
    const item = normalizeHistoryEntry(entry);
    if (item) {
      normalized.push(item);
      if (normalized.length >= limit) {
        break;
      }
    }
  }
  return normalized;
}

function compactHistoryEntries(history, limit, options) {
  const compacted = [];
  const count = Math.min(history.length, limit);
  for (let index = 0; index < count; index += 1) {
    compacted.push(compactHistoryEntry(history[index], options));
  }
  return compacted;
}

function tryPersistHistoryCandidate(candidate) {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(candidate));
    return true;
  } catch {
    return false;
  }
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
  return compactHistoryValue(report, {
    keepAppIcon: options.keepAppIcon !== false,
  }, HISTORY_PATH_ROOT);
}

function compactHistoryValue(value, options, pathState) {
  if (Array.isArray(value)) {
    const result = [];
    for (const entry of value) {
      const compacted = compactHistoryValue(entry, options, HISTORY_PATH_OTHER);
      if (compacted !== COMPACT_SKIP) {
        result.push(compacted);
      }
    }
    return result;
  }

  if (!value || typeof value !== "object") {
    if (typeof value !== "string" || !value.startsWith("data:image/")) {
      return value;
    }

    if (
      options.keepAppIcon &&
      pathState === HISTORY_PATH_APK_ICON_DATA_URI &&
      value.length <= HISTORY_MAX_APP_ICON_DATA_URI_LENGTH
    ) {
      return value;
    }

    return COMPACT_SKIP;
  }

  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldSkipHistoryField(key)) {
      continue;
    }

    const compacted = compactHistoryValue(entry, options, getNextHistoryPathState(pathState, key));
    if (compacted !== COMPACT_SKIP) {
      result[key] = compacted;
    }
  }

  return result;
}

function getNextHistoryPathState(pathState, key) {
  if (pathState === HISTORY_PATH_ROOT && key === "apkInfo") {
    return HISTORY_PATH_APK_INFO;
  }
  if (pathState === HISTORY_PATH_APK_INFO && key === "icon") {
    return HISTORY_PATH_APK_ICON;
  }
  if (pathState === HISTORY_PATH_APK_ICON && key === "dataUri") {
    return HISTORY_PATH_APK_ICON_DATA_URI;
  }

  return HISTORY_PATH_OTHER;
}

function shouldSkipHistoryField(key) {
  return key === "iconUrl" || key === "ruleDetail";
}

export function persistHistoryCollapsed(isCollapsed) {
  try {
    window.localStorage.setItem(HISTORY_COLLAPSED_STORAGE_KEY, isCollapsed ? "true" : "false");
  } catch {
    // The panel remains interactive even if the preference cannot be saved.
  }
}
