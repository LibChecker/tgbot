export const BOT_REPORT_PATH_PARAM = "r";

const REPORT_PATH_PATTERN = /^[A-Za-z0-9_-]{1,512}$/u;

export function resolveBotReportUrlFromLocation(
  search,
  reportDataOrigin,
  fallbackLocale = "en",
) {
  const params = new URLSearchParams(search || "");
  const path = normalizeBotReportPath(params.get(BOT_REPORT_PATH_PARAM));
  if (!path) {
    return "";
  }

  return buildBotReportDataUrl(reportDataOrigin, path, params.get("lang") || fallbackLocale);
}

export function buildBotReportDataUrl(reportDataOrigin, path, locale = "en") {
  const origin = normalizeReportDataOrigin(reportDataOrigin);
  const normalizedPath = normalizeBotReportPath(path);
  if (!origin || !normalizedPath) {
    return "";
  }

  const url = new URL("/report-data", origin);
  url.searchParams.set("path", normalizedPath);
  url.searchParams.set("lang", normalizeLocaleParam(locale));
  return url.href;
}

export function normalizeBotReportPath(value) {
  const text = String(value || "").trim();
  return REPORT_PATH_PATTERN.test(text) ? text : "";
}

function normalizeReportDataOrigin(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }

  return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
}

function normalizeLocaleParam(value) {
  const text = String(value || "").trim();
  return text || "en";
}
