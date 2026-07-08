const DEFAULT_WEBUI_SITE_ORIGIN = "https://example.com";
const DEFAULT_WEBUI_SOURCE_REPOSITORY_URL = "https://github.com/LibChecker/tgbot";

const nodeEnv = getNodeEnv();

export const WEBUI_SITE_ORIGIN = normalizeOrigin(
  nodeEnv.WEBUI_SITE_ORIGIN || nodeEnv.WEBUI_SITE_URL,
) || DEFAULT_WEBUI_SITE_ORIGIN;
export const WEBUI_SITE_URL = `${WEBUI_SITE_ORIGIN}/`;
export const WEBUI_SOCIAL_PREVIEW_URL = normalizeAbsoluteUrl(
  nodeEnv.WEBUI_SOCIAL_PREVIEW_URL,
) || `${WEBUI_SITE_ORIGIN}/social-preview.png`;
export const WEBUI_SOURCE_REPOSITORY_URL = normalizeAbsoluteUrl(
  nodeEnv.WEBUI_SOURCE_REPOSITORY_URL,
) || DEFAULT_WEBUI_SOURCE_REPOSITORY_URL;

export function resolveWebUiSiteConfig(env = {}) {
  const siteOrigin = normalizeOrigin(env.WEBUI_SITE_ORIGIN || env.WEBUI_SITE_URL) || WEBUI_SITE_ORIGIN;
  const siteUrl = `${siteOrigin}/`;
  return {
    siteOrigin,
    siteUrl,
    socialPreviewUrl: normalizeAbsoluteUrl(env.WEBUI_SOCIAL_PREVIEW_URL) || `${siteOrigin}/social-preview.png`,
    sourceRepositoryUrl: normalizeAbsoluteUrl(env.WEBUI_SOURCE_REPOSITORY_URL) || WEBUI_SOURCE_REPOSITORY_URL,
  };
}

function getNodeEnv() {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function normalizeOrigin(value) {
  const url = parseUrl(value);
  return url?.origin || "";
}

function normalizeAbsoluteUrl(value) {
  const url = parseUrl(value);
  return url?.href || "";
}

function parseUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  try {
    return new URL(text);
  } catch {
    return null;
  }
}
