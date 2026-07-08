import { createI18n } from "./i18n.js";
import { logErrorEvent, logInfoEvent, logWarnEvent } from "./observability.js";
import { getStats } from "../../shared/src/report-model.js";
import { assertTelegramApkReport } from "../../shared/src/contracts.js";

/** @typedef {import("../../shared/src/contracts.js").TelegramApkReport} TelegramApkReport */

const TELEGRAPH_API_BASE = "https://api.telegra.ph";
const REPORT_DATA_SCHEMA_VERSION = 1;
const REPORT_DATA_PREFIX = "LC_APK_REPORT_JSON:";
const COMPONENT_SECTION_NAMES = ["activities", "services", "receivers", "providers"];
const COMPACT_LEVELS = [
  {
    nativeLibraries: 160,
    permissions: 120,
    componentsPerType: 160,
    metaData: 80,
    signatures: 8,
    sdkSummary: 48,
    sdkPreviewItems: 6,
  },
  {
    nativeLibraries: 60,
    permissions: 60,
    componentsPerType: 60,
    metaData: 30,
    signatures: 4,
    sdkSummary: 24,
    sdkPreviewItems: 4,
  },
  {
    nativeLibraries: 20,
    permissions: 30,
    componentsPerType: 20,
    metaData: 12,
    signatures: 1,
    sdkSummary: 12,
    sdkPreviewItems: 3,
  },
];

let cachedAccessToken = null;

/**
 * @param {Record<string, unknown>} env
 * @param {TelegramApkReport} report
 */
export async function createApkTelegraphReportDataPage(env, report) {
  const accessToken = await getTelegraphAccessToken(env);
  const candidates = buildReportDataCandidates(report);

  for (const candidate of candidates) {
    try {
      return await createTelegraphReportDataPage(env, accessToken, candidate);
    } catch (error) {
      if (!isContentTooBigError(error)) {
        throw error;
      }
    }
  }

  throw new Error("CONTENT_TOO_BIG");
}

async function fetchTelegraphPage(path, locale = undefined, env = {}) {
  const startedAt = Date.now();
  const { t } = createI18n(locale);
  const normalizedPath = normalizeTelegraphPath(path);
  if (!normalizedPath) {
    throw new Error(t("errors.telegraph_invalid_path"));
  }

  const response = await fetch(
    `${TELEGRAPH_API_BASE}/getPage/${encodeURIComponent(normalizedPath)}?return_content=true`,
    {
      headers: {
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    logErrorEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: "getPage",
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
      },
    );
    throw new Error(t("errors.telegraph_fetch_failed", { status: response.status }));
  }

  const data = await response.json();
  if (!data.ok) {
    logWarnEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: "getPage",
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
        error_name: "TelegraphApiResultError",
      },
    );
    throw new Error(data.error || t("errors.telegraph_fetch_failed_generic"));
  }

  logInfoEvent(
    env,
    { surface: "worker", route: "telegraph_api" },
    "telegraph.api.succeeded",
    {
      command: "getPage",
      result: "success",
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
    },
  );

  return data.result;
}

export async function fetchTelegraphReportData(path, locale = undefined, env = {}) {
  const { t } = createI18n(locale);
  const page = await fetchTelegraphPage(path, locale, env);
  const reportJson = findReportDataJson(page?.content);
  if (!reportJson) {
    throw new Error(t("errors.telegraph_fetch_failed_generic"));
  }

  let payload;
  try {
    payload = JSON.parse(reportJson);
  } catch {
    throw new Error(t("errors.telegraph_fetch_failed_generic"));
  }

  return assertTelegramApkReport(payload?.report || payload);
}

async function getTelegraphAccessToken(env) {
  const configured = normalizeText(env.TELEGRAPH_ACCESS_TOKEN);
  if (configured) {
    return configured;
  }

  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  const account = await telegraphApi(env, "createAccount", {
    short_name: normalizeShortName(env.TELEGRAPH_SHORT_NAME) || "tgbot",
    author_name: getAuthorName(env),
    author_url: normalizeText(env.TELEGRAPH_AUTHOR_URL) || undefined,
  });

  cachedAccessToken = account.access_token;
  return cachedAccessToken;
}

async function telegraphApi(env, method, payload, locale = undefined) {
  const startedAt = Date.now();
  const { t } = createI18n(locale);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value == null) {
      continue;
    }

    body.set(key, String(value));
  }

  const response = await fetch(`${TELEGRAPH_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });

  if (!response.ok) {
    logErrorEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: method,
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
      },
    );
    throw new Error(t("errors.telegraph_api_failed", { method, status: response.status }));
  }

  const data = await response.json();
  if (!data.ok) {
    logWarnEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: method,
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
        error_name: "TelegraphApiResultError",
      },
    );
    throw new Error(data.error || t("errors.telegraph_api_result_failed", { method }));
  }

  logInfoEvent(
    env,
    { surface: "worker", route: "telegraph_api" },
    "telegraph.api.succeeded",
    {
      command: method,
      result: "success",
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
    },
  );

  return data.result;
}

async function createTelegraphReportDataPage(env, accessToken, report) {
  const payload = JSON.stringify({
    version: REPORT_DATA_SCHEMA_VERSION,
    report,
  });
  return telegraphApi(env, "createPage", {
    access_token: accessToken,
    title: buildReportDataPageTitle(report),
    author_name: getAuthorName(env),
    author_url: normalizeText(env.TELEGRAPH_AUTHOR_URL) || undefined,
    content: JSON.stringify(buildReportDataContent(payload)),
    return_content: false,
  }, report.locale);
}

function isContentTooBigError(error) {
  return error instanceof Error && error.message.includes("CONTENT_TOO_BIG");
}

function stripReportIcon(report) {
  return {
    ...report,
    apkInfo: {
      ...report.apkInfo,
      icon: null,
    },
  };
}

function buildReportDataPageTitle(report) {
  return truncateText(`${normalizeText(report.apkInfo.appName) || report.apkInfo.packageName || "APK"} Report Data`, 256);
}

function getAuthorName(env) {
  return truncateText(normalizeText(env.TELEGRAPH_AUTHOR_NAME) || "Telegram APK Info Bot", 128);
}

function normalizeShortName(value) {
  const normalized = normalizeText(value) || null;
  if (!normalized) {
    return null;
  }

  return truncateText(normalized.replaceAll(/\s+/gu, "-"), 32);
}

function normalizeTelegraphPath(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.includes("/") || normalized.includes("?")) {
    return null;
  }

  return normalized;
}

function buildReportDataContent(payload) {
  return [
    {
      tag: "pre",
      children: [
        {
          tag: "code",
          children: [`${REPORT_DATA_PREFIX}${payload}`],
        },
      ],
    },
  ];
}

function getReportStats(report) {
  return report.originalStats || getStats(report.apkInfo);
}

function buildReportDataCandidates(report) {
  const candidates = [];
  pushReportDataCandidate(candidates, report);
  if (report.apkInfo.icon?.dataUri) {
    pushReportDataCandidate(candidates, stripReportIcon(report));
  }

  for (const limits of COMPACT_LEVELS) {
    const compacted = compactReport(report, limits);
    pushReportDataCandidate(candidates, compacted);
    if (compacted.apkInfo.icon?.dataUri) {
      pushReportDataCandidate(candidates, stripReportIcon(compacted));
    }
  }

  const minimal = buildMinimalReport(report);
  pushReportDataCandidate(candidates, minimal);
  if (minimal.apkInfo.icon?.dataUri) {
    pushReportDataCandidate(candidates, stripReportIcon(minimal));
  }

  return candidates;
}

function pushReportDataCandidate(candidates, report) {
  candidates.push(prepareReportForWebUiStorage(report));
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

function compactReport(report, limits) {
  const components = report.apkInfo.components || {};
  const signatures = report.apkInfo.signatures || {};
  const metaData = report.apkInfo.metaData || {};

  return {
    ...report,
    isCompacted: true,
    originalStats: getReportStats(report),
    apkInfo: {
      ...report.apkInfo,
      nativeLibraries: (report.apkInfo.nativeLibraries || []).slice(0, limits.nativeLibraries),
      permissions: (report.apkInfo.permissions || []).slice(0, limits.permissions),
      components: {
        activities: (components.activities || []).slice(0, limits.componentsPerType),
        services: (components.services || []).slice(0, limits.componentsPerType),
        receivers: (components.receivers || []).slice(0, limits.componentsPerType),
        providers: (components.providers || []).slice(0, limits.componentsPerType),
      },
      signatures: {
        ...signatures,
        certificates: (signatures.certificates || []).slice(0, limits.signatures),
      },
      metaData: {
        application: (metaData.application || []).slice(0, limits.metaData),
        components: [],
      },
      sdkSummary: compactSdkSummary(report.apkInfo.sdkSummary, limits),
    },
  };
}

function buildMinimalReport(report) {
  return compactReport(report, {
    nativeLibraries: 0,
    permissions: 0,
    componentsPerType: 0,
    metaData: 0,
    signatures: 0,
    sdkSummary: 0,
    sdkPreviewItems: 0,
  });
}

function compactSdkSummary(sdkSummary, limits) {
  if (!sdkSummary) {
    return sdkSummary;
  }

  return {
    native: compactSdkSummaryEntries(sdkSummary.native, limits),
    components: compactSdkSummaryEntries(sdkSummary.components, limits),
  };
}

function compactSdkSummaryEntries(entries, limits) {
  return (entries || [])
    .slice(0, limits.sdkSummary)
    .map((entry) => ({
      ...entry,
      detail: entry.detail ? truncateText(entry.detail, 180) : entry.detail,
      previewItems: (entry.previewItems || []).slice(0, limits.sdkPreviewItems),
    }));
}

function normalizeText(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function truncateText(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function findReportDataJson(content) {
  const text = collectNodeText(content);
  const markerIndex = text.indexOf(REPORT_DATA_PREFIX);
  if (markerIndex < 0) {
    return "";
  }

  return text.slice(markerIndex + REPORT_DATA_PREFIX.length).trim();
}

function collectNodeText(value) {
  if (Array.isArray(value)) {
    return value.map(collectNodeText).join("");
  }
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return collectNodeText(value.children || []);
}

export const __telegraphTestInternals = {
  buildReportDataContent,
  findReportDataJson,
  prepareReportForWebUiStorage,
};
