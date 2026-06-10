/** @typedef {import("@shared/contracts.js").AnalyticsEventFields} AnalyticsEventFields */
/** @typedef {import("@shared/contracts.js").ApkReport} ApkReport */

/**
 * @param {File | { name?: string, size?: number } | null | undefined} file
 * @returns {AnalyticsEventFields}
 */
export function getFileAnalyticsFields(file) {
  if (!file) {
    return {};
  }

  return compactAnalyticsObject({
    file_extension: getFileExtension(file.name),
    size_bucket: formatSizeBucket(file.size),
  });
}

/**
 * @param {Partial<ApkReport> | null | undefined} report
 * @returns {AnalyticsEventFields}
 */
export function getReportAnalyticsFields(report) {
  const info = report?.apkInfo || {};
  const archive = info.archive || null;

  return compactAnalyticsObject({
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

/**
 * @param {Record<string, unknown>} value
 * @returns {AnalyticsEventFields}
 */
export function compactAnalyticsObject(value) {
  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null && entry !== "") {
      compacted[key] = entry;
    }
  }
  return compacted;
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
