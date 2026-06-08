const APPLE_FROZEN_OS_VERSIONS = new Set(["18.6", "18.7", "10.15", "10.15.7"]);

export function detectTerminalSystemFromNavigator(navigatorValue = {}) {
  return parseSystemFromUserAgent(
    String(navigatorValue.userAgent || ""),
    String(navigatorValue.platform || ""),
  );
}

export function normalizeSystemPlatform(platform, version) {
  const platformText = String(platform || "").trim();
  const versionText = cleanSystemVersion(version);
  const platformKey = platformText.toLowerCase();

  if (!platformText) {
    return { name: "", version: versionText };
  }

  if (platformKey.includes("mac")) {
    return { name: "macOS", version: versionText };
  }

  if (platformKey.includes("win")) {
    return { name: "Windows", version: normalizeWindowsUaDataVersion(versionText) };
  }

  if (platformKey.includes("android")) {
    return { name: "Android", version: versionText };
  }

  if (platformKey.includes("ios")) {
    return { name: "iOS", version: versionText };
  }

  if (platformKey.includes("chrome os") || platformKey.includes("cros")) {
    return { name: "ChromeOS", version: versionText };
  }

  if (platformKey.includes("linux")) {
    return { name: "Linux", version: versionText };
  }

  return { name: platformText, version: versionText };
}

export function parseSystemFromUserAgent(userAgent, platform = "") {
  const userAgentText = String(userAgent || "");
  const platformText = String(platform || "");
  const iosVersion = userAgentText.match(/(?:CPU(?: iPhone)? OS|iPhone OS)\s+([0-9_]+)/iu);
  const androidVersion = userAgentText.match(/Android\s+([0-9][0-9._]*)/iu);
  const chromeOsVersion = userAgentText.match(/CrOS\s+\S+\s+([0-9.]+)/iu);
  const macOsVersion = userAgentText.match(/Mac OS X\s+([0-9_]+)/iu);
  const windowsVersion = userAgentText.match(/Windows NT\s+([0-9.]+)/iu);

  if (/iPad/iu.test(platformText)) {
    return buildTerminalSystem(
      "iPadOS",
      resolveAppleMobileSystemVersion(userAgentText, iosVersion?.[1]),
    );
  }

  if (/iPhone|iPod/iu.test(platformText)) {
    return buildTerminalSystem(
      "iOS",
      resolveAppleMobileSystemVersion(userAgentText, iosVersion?.[1]),
    );
  }

  if (androidVersion) {
    return buildTerminalSystem("Android", androidVersion[1]);
  }

  if (chromeOsVersion) {
    return buildTerminalSystem("ChromeOS", chromeOsVersion[1]);
  }

  if (macOsVersion && /Mobile/iu.test(userAgentText)) {
    return buildTerminalSystem(
      "iPadOS",
      resolveAppleMobileSystemVersion(userAgentText, iosVersion?.[1] || macOsVersion[1]),
    );
  }

  if (macOsVersion) {
    return buildTerminalSystem("macOS", macOsVersion[1]);
  }

  if (windowsVersion) {
    return buildTerminalSystem("Windows", normalizeWindowsVersion(windowsVersion[1]));
  }

  if (/Linux/iu.test(userAgentText) || /Linux/iu.test(platformText)) {
    return buildTerminalSystem("Linux", "");
  }

  return buildTerminalSystem(platformText || "Unknown", "");
}

function buildTerminalSystem(name, version) {
  return {
    name: String(name || "Unknown").trim(),
    version: cleanSystemVersion(version),
    source: "userAgent",
  };
}

function resolveAppleMobileSystemVersion(userAgent, userAgentVersion) {
  const explicitSystemVersion = findExplicitAppleMobileSystemVersion(userAgent);
  if (explicitSystemVersion) {
    return explicitSystemVersion;
  }

  const normalizedUserAgentVersion = cleanSystemVersion(userAgentVersion);
  const safariVersion = findMobileSafariVersion(userAgent);
  if (shouldUseSafariVersionForAppleMobileSystem(normalizedUserAgentVersion, safariVersion)) {
    return safariVersion;
  }

  return normalizedUserAgentVersion;
}

function findExplicitAppleMobileSystemVersion(userAgent) {
  const match = String(userAgent || "").match(/(?:OSVersion|SysVersion)\/([0-9][0-9._]*)/iu);
  return match ? cleanSystemVersion(match[1]) : "";
}

function findMobileSafariVersion(userAgent) {
  const match = String(userAgent || "").match(/\bVersion\/([0-9][0-9._]*)\s+Mobile\/\S+\s+Safari\//iu);
  return match ? cleanSystemVersion(match[1]) : "";
}

function shouldUseSafariVersionForAppleMobileSystem(userAgentVersion, safariVersion) {
  const safariMajor = Number.parseInt(cleanSystemVersion(safariVersion).split(".")[0], 10);
  if (!Number.isFinite(safariMajor) || safariMajor < 26) {
    return false;
  }

  return !userAgentVersion || APPLE_FROZEN_OS_VERSIONS.has(userAgentVersion);
}

function cleanSystemVersion(value) {
  return String(value || "").trim().replaceAll("_", ".");
}

function normalizeWindowsVersion(value) {
  const version = cleanSystemVersion(value);
  const knownVersions = {
    "10.0": "10",
    "6.3": "8.1",
    "6.2": "8",
    "6.1": "7",
  };

  return knownVersions[version] || version;
}

function normalizeWindowsUaDataVersion(value) {
  const version = cleanSystemVersion(value);
  const major = Number.parseInt(version.split(".")[0], 10);

  if (major >= 13) {
    return "11";
  }

  if (major > 0) {
    return "10";
  }

  return version;
}
