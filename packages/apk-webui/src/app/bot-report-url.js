export const BOT_REPORT_REF_PARAM = "r";

const REPORT_REF_PATTERN = /^rp_[a-f0-9]{32}$/u;

export function resolveBotReportUrlFromLocation(
  search,
  reportDataOrigin,
  fallbackLocale = "en",
) {
  const params = new URLSearchParams(search || "");
  const ref = normalizeBotReportRef(params.get(BOT_REPORT_REF_PARAM));
  if (!ref) {
    return "";
  }

  return buildBotReportDataUrl(reportDataOrigin, ref, params.get("lang") || fallbackLocale);
}

export function buildBotReportDataUrl(reportDataOrigin, ref, locale = "en") {
  const origin = normalizeReportDataOrigin(reportDataOrigin);
  const normalizedRef = normalizeBotReportRef(ref);
  if (!origin || !normalizedRef) {
    return "";
  }

  const url = new URL("/report-data", origin);
  url.searchParams.set("ref", normalizedRef);
  url.searchParams.set("lang", normalizeLocaleParam(locale));
  return url.href;
}

export function normalizeBotReportRef(value) {
  const text = String(value || "").trim();
  return REPORT_REF_PATTERN.test(text) ? text : "";
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
