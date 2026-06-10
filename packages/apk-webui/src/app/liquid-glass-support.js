const ANDROID_CHROMIUM_SVG_BACKDROP_FILTER_MAX_BROKEN_MAJOR = 115;
const ANDROID_BROWSER_SHELLS_WITH_BROKEN_SVG_BACKDROP_FILTER = [
  /\bHeyTapBrowser\//iu,
  /\bOplusBrowser\//iu,
  /\bOppoBrowser\//iu,
  /\bRealmeBrowser\//iu,
];

export function getLiquidGlassBrowserConfigFallbackReason(navigatorValue = globalThis.navigator) {
  const userAgent = getNavigatorText(navigatorValue?.userAgent);
  const platform = [
    getNavigatorText(navigatorValue?.platform),
    getNavigatorText(navigatorValue?.userAgentData?.platform),
  ].join(" ");

  if (!isAndroidBrowserConfig(userAgent, platform)) {
    return "";
  }

  // Some Android Chromium shells parse SVG backdrop filters but render them as plain transparency.
  if (ANDROID_BROWSER_SHELLS_WITH_BROKEN_SVG_BACKDROP_FILTER.some((pattern) => pattern.test(userAgent))) {
    return "android-browser-shell-svg-backdrop-filter";
  }

  const chromiumMajor = getChromiumMajorVersion(userAgent, navigatorValue);
  if (chromiumMajor > 0 && chromiumMajor <= ANDROID_CHROMIUM_SVG_BACKDROP_FILTER_MAX_BROKEN_MAJOR) {
    return "android-chromium-svg-backdrop-filter";
  }

  return "";
}

export function getChromiumMajorVersion(userAgent, navigatorValue = null) {
  const userAgentVersion = Number.parseInt(
    String(userAgent || "").match(/\b(?:Chrome|Chromium|CriOS)\/(\d+)/iu)?.[1] || "",
    10,
  );
  if (Number.isFinite(userAgentVersion) && userAgentVersion > 0) {
    return userAgentVersion;
  }

  const brands = navigatorValue?.userAgentData?.brands || [];
  for (const brand of brands) {
    const brandName = getNavigatorText(brand?.brand);
    if (!/\b(?:Chromium|Google Chrome|Chrome)\b/iu.test(brandName)) {
      continue;
    }

    const brandVersion = Number.parseInt(getNavigatorText(brand?.version), 10);
    if (Number.isFinite(brandVersion) && brandVersion > 0) {
      return brandVersion;
    }
  }

  return 0;
}

function isAndroidBrowserConfig(userAgent, platform) {
  return /\bAndroid\b/iu.test(`${userAgent} ${platform}`);
}

function getNavigatorText(value) {
  return typeof value === "string" ? value : "";
}
