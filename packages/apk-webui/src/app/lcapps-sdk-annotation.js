import { createSdkMarkerAnnotator } from "@shared/sdk-markers.js";
import libcheckerRulesCoreUrl from "@shared/generated/libchecker-rules-core.js?url";
import libcheckerSdkIconsUrl from "@shared/generated/libchecker-sdk-icons.js?url";

const sdkIconDataUriCache = new Map();
let sdkAnnotationModulesPromise = null;

/** @typedef {import("@shared/contracts.js").ApkReport} ApkReport */

/**
 * @param {ApkReport} report
 * @returns {Promise<ApkReport>}
 */
export async function annotateLcappsReportSdkMarkers(report) {
  const startedAt = performance.now();
  const sdkModules = await loadSdkAnnotationModules();
  const info = report.apkInfo || {};
  const annotated = sdkModules.annotateSdkMarkers(info, sdkModules.resolveSdkIconDataUri);
  const mergedApkInfo = {
    ...info,
    ...annotated,
  };

  report.apkInfo = mergedApkInfo;
  report.analysisProfile = buildLcappsSdkAnalysisProfile(
    report.analysisProfile,
    report.terminalSystem,
    mergedApkInfo,
    sdkModules,
  );
  report.durationMs = Math.max(
    Number(report.durationMs) || 0,
    Math.round(performance.now() - startedAt),
  );
  return report;
}

function loadSdkAnnotationModules() {
  if (!sdkAnnotationModulesPromise) {
    sdkAnnotationModulesPromise = Promise.all([
      import(/* @vite-ignore */ libcheckerRulesCoreUrl),
      import(/* @vite-ignore */ libcheckerSdkIconsUrl),
    ]).then(([rulesModule, iconsModule]) => {
      const rules = rulesModule.LIBCHECKER_RULES_CORE || [];
      const sdkIconSvgs = iconsModule.LIBCHECKER_SDK_ICON_SVGS || {};
      return {
        annotateSdkMarkers: createSdkMarkerAnnotator(rules),
        ruleCount: rules.length,
        iconCount: Object.keys(sdkIconSvgs).length,
        resolveSdkIconDataUri: (iconName) => resolveSdkIconDataUri(iconName, sdkIconSvgs),
      };
    });
  }

  return sdkAnnotationModulesPromise;
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

function buildLcappsSdkAnalysisProfile(profile, terminalSystem, apkInfo, sdkModules) {
  const sdkSummary = apkInfo.sdkSummary || {};
  const nativeSdkMarkerCount = countSdkSummaryItems(sdkSummary.native);
  const componentSdkMarkerCount = countSdkSummaryItems(sdkSummary.components);

  return {
    ...(profile || {}),
    id: String(profile?.id || "lcapps-import"),
    capabilities: mergeCapabilities(profile?.capabilities, "libchecker-sdk-rules"),
    ruleCount: sdkModules.ruleCount,
    iconCount: sdkModules.iconCount,
    uniqueSdkCount: countUniqueSdkEntries(sdkSummary),
    sdkMarkerCount: nativeSdkMarkerCount + componentSdkMarkerCount,
    nativeSdkMarkerCount,
    componentSdkMarkerCount,
    runtime: {
      ...(profile?.runtime || {}),
      worker: Boolean(profile?.runtime?.worker),
      decompressionStream: Boolean(profile?.runtime?.decompressionStream),
      system: terminalSystem || profile?.runtime?.system || {},
    },
  };
}

function mergeCapabilities(capabilities, requiredCapability) {
  const values = Array.isArray(capabilities) ? capabilities.filter(Boolean).map(String) : [];
  if (!values.includes(requiredCapability)) {
    values.push(requiredCapability);
  }
  return values;
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
