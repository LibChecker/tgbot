export async function detectTerminalSystem() {
  const navigatorValue = window.navigator || {};
  const userAgentData = navigatorValue.userAgentData;

  if (userAgentData && typeof userAgentData.getHighEntropyValues === "function") {
    try {
      const values = await userAgentData.getHighEntropyValues(["platform", "platformVersion"]);
      const system = normalizeSystemPlatform(
        values.platform || userAgentData.platform || navigatorValue.platform,
        values.platformVersion,
      );

      if (system.name || system.version) {
        return {
          ...system,
          source: "userAgentData",
        };
      }
    } catch {
      // Fall back to the reduced user agent string.
    }
  }

  return parseSystemFromUserAgent(navigatorValue.userAgent, navigatorValue.platform);
}

function normalizeSystemPlatform(platform, version) {
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

function parseSystemFromUserAgent(userAgent, platform = "") {
  const userAgentText = String(userAgent || "");
  const platformText = String(platform || "");
  const iosVersion = userAgentText.match(/(?:CPU(?: iPhone)? OS|iPhone OS)\s+([0-9_]+)/iu);
  const androidVersion = userAgentText.match(/Android\s+([0-9][0-9._]*)/iu);
  const chromeOsVersion = userAgentText.match(/CrOS\s+\S+\s+([0-9.]+)/iu);
  const macOsVersion = userAgentText.match(/Mac OS X\s+([0-9_]+)/iu);
  const windowsVersion = userAgentText.match(/Windows NT\s+([0-9.]+)/iu);

  if (/iPad/iu.test(platformText)) {
    return buildTerminalSystem("iPadOS", iosVersion?.[1]);
  }

  if (/iPhone|iPod/iu.test(platformText)) {
    return buildTerminalSystem("iOS", iosVersion?.[1]);
  }

  if (androidVersion) {
    return buildTerminalSystem("Android", androidVersion[1]);
  }

  if (chromeOsVersion) {
    return buildTerminalSystem("ChromeOS", chromeOsVersion[1]);
  }

  if (macOsVersion && /Mobile/iu.test(userAgentText)) {
    return buildTerminalSystem("iPadOS", iosVersion?.[1] || macOsVersion[1]);
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
