import { readApkInfo } from "./modules/apk.js";
import { createI18n, normalizeLocale } from "./modules/i18n.js";
import { annotateSdkMarkers } from "./modules/sdk-markers.js";
import { LIBCHECKER_RULES } from "./modules/generated/libchecker-rules.js";
import { LIBCHECKER_SDK_ICON_SVGS } from "./modules/generated/libchecker-sdk-icons.js";

const APK_MIME_TYPE = "application/vnd.android.package-archive";

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== "analyze") {
    return;
  }

  analyze(message).catch((error) => {
    const { t } = createWorkerI18n(message.locale);
    self.postMessage({
      type: "error",
      jobId: message.jobId,
      error: getErrorMessage(error, t),
    });
  });
});

async function analyze(message) {
  const startedAt = performance.now();
  const file = message.file;
  const { t } = createWorkerI18n(message.locale);

  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error(t("noFile"));
  }

  if (!isLikelyApk(file)) {
    throw new Error(t("invalidFile"));
  }

  if (typeof DecompressionStream !== "function") {
    throw new Error(t("unsupportedDecompression"));
  }

  self.postMessage({
    type: "progress",
    jobId: message.jobId,
    stage: "reading",
  });

  const buffer = await file.arrayBuffer();

  self.postMessage({
    type: "progress",
    jobId: message.jobId,
    stage: "parsing",
  });

  const apkInfo = await readApkInfo(buffer);
  const annotated = annotateSdkMarkers(apkInfo, resolveSdkIconDataUri);
  const mergedApkInfo = {
    ...apkInfo,
    ...annotated,
  };
  const terminalSystem = normalizeTerminalSystem(message.terminalSystem);
  const analysisProfile = buildAnalysisProfile(mergedApkInfo, terminalSystem);

  self.postMessage({
    type: "result",
    jobId: message.jobId,
    report: {
      locale: normalizeLocale(message.locale),
      terminalSystem,
      analysisProfile,
      durationMs: Math.round(performance.now() - startedAt),
      fileName: file.name || "local.apk",
      fileSizeBytes: file.size || buffer.byteLength || 0,
      analyzedAt: new Date().toISOString(),
      apkInfo: mergedApkInfo,
    },
  });
}

function isLikelyApk(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return name.endsWith(".apk") || type === APK_MIME_TYPE || type.includes("android.package-archive");
}

function resolveSdkIconDataUri(iconName) {
  const svg = LIBCHECKER_SDK_ICON_SVGS[iconName] || LIBCHECKER_SDK_ICON_SVGS.ic_sdk_placeholder;
  if (!svg) {
    return "";
  }

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildAnalysisProfile(apkInfo, terminalSystem) {
  const sdkSummary = apkInfo.sdkSummary || {};
  const nativeSdkMarkerCount = countSdkSummaryItems(sdkSummary.native);
  const componentSdkMarkerCount = countSdkSummaryItems(sdkSummary.components);

  return {
    id: "browser-local-apk-analyzer",
    capabilities: [
      "manifest",
      "resources",
      "native-libraries",
      "apk-signatures",
      "dex-feature-markers",
      "libchecker-sdk-rules",
    ],
    ruleCount: LIBCHECKER_RULES.length,
    iconCount: Object.keys(LIBCHECKER_SDK_ICON_SVGS).length,
    uniqueSdkCount: countUniqueSdkEntries(sdkSummary),
    sdkMarkerCount: nativeSdkMarkerCount + componentSdkMarkerCount,
    nativeSdkMarkerCount,
    componentSdkMarkerCount,
    runtime: {
      worker: true,
      decompressionStream: typeof DecompressionStream === "function",
      system: terminalSystem,
    },
  };
}

function normalizeTerminalSystem(value) {
  if (!value || typeof value !== "object") {
    return detectTerminalSystemFromNavigator();
  }

  const name = String(value.name || "").trim();
  const version = String(value.version || "").trim();
  const source = String(value.source || "").trim();

  if (!name && !version) {
    return detectTerminalSystemFromNavigator();
  }

  return {
    name,
    version,
    source: source || "browser",
  };
}

function detectTerminalSystemFromNavigator() {
  const navigatorValue = self.navigator || {};
  return parseSystemFromUserAgent(
    String(navigatorValue.userAgent || ""),
    String(navigatorValue.platform || ""),
  );
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

function countSdkSummaryItems(entries = []) {
  return entries.reduce((sum, entry) => sum + (Number(entry.count) || 0), 0);
}

function countUniqueSdkEntries(sdkSummary = {}) {
  const keys = new Set();

  for (const entry of [...(sdkSummary.native || []), ...(sdkSummary.components || [])]) {
    keys.add(entry.key || `${entry.label || ""}::${entry.iconName || ""}`);
  }

  return keys.size;
}

function createWorkerI18n(locale) {
  return createI18n(locale, { scope: "webui" });
}

function getErrorMessage(error, t) {
  if (error instanceof Error) {
    return error.message;
  }

  return t("unknownError");
}
