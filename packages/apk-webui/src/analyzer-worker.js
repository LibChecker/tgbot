import { readAndroidPackageInfo } from "@shared/apk.js";
import { assertAnalyzerWorkerRequest, assertApkReport } from "@shared/contracts.js";
import { createI18n, normalizeLocale } from "@shared/i18n.js";
import { detectTerminalSystemFromNavigator as detectTerminalSystemFromNavigatorValue } from "@shared/terminal-system.js";
import libcheckerRulesCoreUrl from "@shared/generated/libchecker-rules-core.js?url";
import libcheckerSdkIconsUrl from "@shared/generated/libchecker-sdk-icons.js?url";

const APK_MIME_TYPE = "application/vnd.android.package-archive";
const ANDROID_PACKAGE_EXTENSIONS = [".apk", ".apks", ".apkm", ".xapk"];
const READ_PROGRESS_WEIGHT = 0.35;
const sdkIconDataUriCache = new Map();
let sdkModulesPromise = null;

self.addEventListener("message", (event) => {
  const rawMessage = event.data || {};
  if (rawMessage.type !== "analyze") {
    return;
  }

  Promise.resolve()
    .then(() => analyze(assertAnalyzerWorkerRequest(rawMessage)))
    .catch((error) => {
      const { t } = createWorkerI18n(rawMessage.locale);
      self.postMessage({
        type: "error",
        jobId: Number(rawMessage.jobId) || 0,
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
    progress: 0,
  });

  const sdkModulesTask = loadSdkModules();
  const buffer = await readFileBuffer(file, message.jobId);

  self.postMessage({
    type: "progress",
    jobId: message.jobId,
    stage: "parsing",
    progress: 0.42,
  });

  const apkInfo = await readAndroidPackageInfo(buffer);
  self.postMessage({
    type: "progress",
    jobId: message.jobId,
    stage: "parsing",
    progress: 0.78,
  });
  const sdkModules = await sdkModulesTask;
  self.postMessage({
    type: "progress",
    jobId: message.jobId,
    stage: "parsing",
    progress: 0.86,
  });
  const annotated = sdkModules.annotateSdkMarkers(
    apkInfo,
    sdkModules.resolveSdkIconDataUri,
  );
  self.postMessage({
    type: "progress",
    jobId: message.jobId,
    stage: "parsing",
    progress: 0.92,
  });
  const mergedApkInfo = {
    ...apkInfo,
    ...annotated,
  };
  const terminalSystem = normalizeTerminalSystem(message.terminalSystem);
  const analysisProfile = buildAnalysisProfile(mergedApkInfo, terminalSystem, sdkModules);
  const report = assertApkReport({
    locale: normalizeLocale(message.locale),
    terminalSystem,
    analysisProfile,
    durationMs: Math.round(performance.now() - startedAt),
    fileName: file.name || "local.apk",
    fileSizeBytes: file.size || buffer.byteLength || 0,
    analyzedAt: new Date().toISOString(),
    apkInfo: mergedApkInfo,
  });

  self.postMessage({
    type: "result",
    jobId: message.jobId,
    report,
  });
}

async function readFileBuffer(file, jobId) {
  const totalBytes = Number(file.size) || 0;
  if (!totalBytes || typeof file.stream !== "function") {
    const buffer = await file.arrayBuffer();
    postReadProgress(jobId, buffer.byteLength || totalBytes, buffer.byteLength || totalBytes);
    return buffer;
  }

  const reader = file.stream().getReader();
  const bytes = new Uint8Array(totalBytes);
  let loadedBytes = 0;
  let lastProgress = 0;
  let lastEmittedAt = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value?.byteLength) {
      continue;
    }

    if (loadedBytes + value.byteLength > bytes.byteLength) {
      const chunks = [bytes.subarray(0, loadedBytes), value];
      loadedBytes += value.byteLength;
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        if (next.value?.byteLength) {
          chunks.push(next.value);
          loadedBytes += next.value.byteLength;
        }
      }
      postReadProgress(jobId, loadedBytes, totalBytes, READ_PROGRESS_WEIGHT);
      return new Blob(chunks).arrayBuffer();
    }

    bytes.set(value, loadedBytes);
    loadedBytes += value.byteLength;
    const progress = Math.min(READ_PROGRESS_WEIGHT, (loadedBytes / totalBytes) * READ_PROGRESS_WEIGHT);
    const now = performance.now();
    if (progress - lastProgress >= 0.015 || now - lastEmittedAt >= 160 || loadedBytes >= totalBytes) {
      postReadProgress(jobId, loadedBytes, totalBytes, progress);
      lastProgress = progress;
      lastEmittedAt = now;
    }
  }

  postReadProgress(jobId, loadedBytes, totalBytes, READ_PROGRESS_WEIGHT);
  return loadedBytes === totalBytes ? bytes.buffer : bytes.buffer.slice(0, loadedBytes);
}

function postReadProgress(jobId, loadedBytes, totalBytes, progress = READ_PROGRESS_WEIGHT) {
  self.postMessage({
    type: "progress",
    jobId,
    stage: "reading",
    progress,
    loadedBytes,
    totalBytes,
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
      import("@shared/sdk-markers.js"),
      import(/* @vite-ignore */ libcheckerRulesCoreUrl),
      import(/* @vite-ignore */ libcheckerSdkIconsUrl),
    ]).then(([sdkMarkersModule, rulesModule, iconsModule]) => {
      const sdkIconSvgs = iconsModule.LIBCHECKER_SDK_ICON_SVGS || {};
      const rules = rulesModule.LIBCHECKER_RULES_CORE || [];
      return {
        annotateSdkMarkers: sdkMarkersModule.createSdkMarkerAnnotator(rules),
        ruleCount: rules.length,
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
