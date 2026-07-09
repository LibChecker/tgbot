import { assertReportDataReport } from "../../shared/src/contracts.js";

const REPORT_DATA_SCHEMA_VERSION = 1;
const REPORT_DATA_KEY_PREFIX = "reports/v1/";
const REPORT_DATA_REF_PATTERN = /^rp_[a-f0-9]{32}$/u;
const REPORT_DATA_CONTENT_TYPE = "application/json; charset=UTF-8";
const COMPONENT_SECTION_NAMES = ["activities", "services", "receivers", "providers"];

/**
 * @param {Record<string, unknown>} env
 * @param {unknown} report
 */
export async function createApkReportDataEntry(env, report) {
  const bucket = getReportDataBucket(env);
  const storedReport = prepareReportForWebUiStorage(assertReportDataReport(report));
  const payload = JSON.stringify({
    version: REPORT_DATA_SCHEMA_VERSION,
    report: storedReport,
  });
  const ref = await buildReportRef(payload);

  await bucket.put(buildReportDataKey(ref), payload, {
    httpMetadata: {
      contentType: REPORT_DATA_CONTENT_TYPE,
    },
    customMetadata: {
      schema_version: String(REPORT_DATA_SCHEMA_VERSION),
      package_name: String(storedReport.apkInfo?.packageName || ""),
    },
  });

  return { ref };
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} ref
 */
export async function fetchReportData(ref, env) {
  const normalizedRef = normalizeReportRef(ref);
  if (!normalizedRef) {
    throw createReportDataError("report_data_invalid_ref", "Invalid report data reference");
  }

  const object = await getReportDataBucket(env).get(buildReportDataKey(normalizedRef));
  if (!object) {
    throw createReportDataError("report_data_not_found", "Report data was not found");
  }

  const payload = JSON.parse(await object.text());
  return assertReportDataReport(payload?.report || payload);
}

export function normalizeReportRef(value) {
  const text = String(value || "").trim();
  return REPORT_DATA_REF_PATTERN.test(text) ? text : "";
}

function getReportDataBucket(env = {}) {
  const bucket = env.REPORT_DATA_BUCKET;
  if (!bucket || typeof bucket.get !== "function" || typeof bucket.put !== "function") {
    throw createReportDataError("report_data_bucket_missing", "REPORT_DATA_BUCKET is not configured");
  }
  return bucket;
}

function buildReportDataKey(ref) {
  return `${REPORT_DATA_KEY_PREFIX}${ref}.json`;
}

async function buildReportRef(payload) {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `rp_${hex}`;
}

function prepareReportForWebUiStorage(report) {
  return {
    ...report,
    apkInfo: {
      ...report.apkInfo,
      nativeLibraries: (report.apkInfo.nativeLibraries || []).map(stripSdkRuleDetailFromItem),
      components: stripComponentSdkRuleDetails(report.apkInfo.components),
      sdkSummary: stripSdkSummaryRuleDetails(report.apkInfo.sdkSummary),
    },
  };
}

function stripComponentSdkRuleDetails(components = {}) {
  return Object.fromEntries(COMPONENT_SECTION_NAMES.map((sectionName) => [
    sectionName,
    (components[sectionName] || []).map(stripSdkRuleDetailFromItem),
  ]));
}

function stripSdkSummaryRuleDetails(sdkSummary) {
  if (!sdkSummary) {
    return sdkSummary;
  }

  return {
    native: (sdkSummary.native || []).map(stripRuleDetail),
    components: (sdkSummary.components || []).map(stripRuleDetail),
  };
}

function stripSdkRuleDetailFromItem(item) {
  return item?.sdk ? { ...item, sdk: stripRuleDetail(item.sdk) } : item;
}

function stripRuleDetail(item) {
  if (!item || typeof item !== "object") {
    return item;
  }

  return {
    ...item,
    ruleDetail: null,
  };
}

function createReportDataError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export const __reportStoreTestInternals = {
  buildReportDataKey,
  prepareReportForWebUiStorage,
};
