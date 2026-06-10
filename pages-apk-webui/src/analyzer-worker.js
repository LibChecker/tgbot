import { readAndroidPackageInfo } from "./modules/apk.js";
import { createI18n, normalizeLocale } from "./modules/i18n.js";
import { detectTerminalSystemFromNavigator as detectTerminalSystemFromNavigatorValue } from "./modules/terminal-system.js";

const APK_MIME_TYPE = "application/vnd.android.package-archive";
const ANDROID_PACKAGE_EXTENSIONS = [".apk", ".apks", ".apkm", ".xapk"];
const sdkIconDataUriCache = new Map();
let sdkModulesPromise = null;

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

  const sdkModulesTask = loadSdkModules();
  const buffer = await file.arrayBuffer();

  self.postMessage({
    type: "progress",
    jobId: message.jobId,
    stage: "parsing",
  });

  const apkInfo = await readAndroidPackageInfo(buffer);
  const sdkModules = await sdkModulesTask;
  const annotated = sdkModules.annotateSdkMarkers(apkInfo, sdkModules.resolveSdkIconDataUri);
  const mergedApkInfo = {
    ...apkInfo,
    ...annotated,
  };
  const terminalSystem = normalizeTerminalSystem(message.terminalSystem);
  const analysisProfile = buildAnalysisProfile(mergedApkInfo, terminalSystem, sdkModules);

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
  return (
    ANDROID_PACKAGE_EXTENSIONS.some((extension) => name.endsWith(extension)) ||
    type === APK_MIME_TYPE ||
    type.includes("android.package-archive")
  );
}

function loadSdkModules() {
  if (!sdkModulesPromise) {
    sdkModulesPromise = Promise.all([
      import("./modules/sdk-markers.js"),
      import("./modules/generated/libchecker-rules.js"),
      import("./modules/generated/libchecker-sdk-icons.js"),
    ]).then(([sdkMarkersModule, rulesModule, iconsModule]) => {
      const sdkIconSvgs = iconsModule.LIBCHECKER_SDK_ICON_SVGS || {};
      return {
        annotateSdkMarkers: sdkMarkersModule.annotateSdkMarkers,
        ruleCount: (rulesModule.LIBCHECKER_RULES || []).length,
        iconCount: Object.keys(sdkIconSvgs).length,
        resolveSdkIconDataUri: (iconName) => resolveSdkIconDataUri(iconName, sdkIconSvgs),
      };
    });
  }
  return sdkModulesPromise;
}

function resolveSdkIconDataUri(iconName, sdkIconSvgs) {
  const cacheKey = iconName || "ic_sdk_placeholder";
  if (sdkIconDataUriCache.has(cacheKey)) {
    return sdkIconDataUriCache.get(cacheKey);
  }

  const svg = sdkIconSvgs[iconName] || sdkIconSvgs.ic_sdk_placeholder;
  if (!svg) {
    sdkIconDataUriCache.set(cacheKey, "");
    return "";
  }

  const dataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  sdkIconDataUriCache.set(cacheKey, dataUri);
  return dataUri;
}

function buildAnalysisProfile(apkInfo, terminalSystem, sdkModules) {
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
    ruleCount: sdkModules.ruleCount,
    iconCount: sdkModules.iconCount,
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
  return detectTerminalSystemFromNavigatorValue(self.navigator || {});
}

function countSdkSummaryItems(entries = []) {
  let count = 0;
  for (const entry of entries || []) {
    count += Number(entry.count) || 0;
  }
  return count;
}

function countUniqueSdkEntries(sdkSummary = {}) {
  const keys = new Set();

  addSdkEntryKeys(keys, sdkSummary.native);
  addSdkEntryKeys(keys, sdkSummary.components);

  return keys.size;
}

function addSdkEntryKeys(keys, entries = []) {
  for (const entry of entries || []) {
    keys.add(entry.key || `${entry.label || ""}::${entry.iconName || ""}`);
  }
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
