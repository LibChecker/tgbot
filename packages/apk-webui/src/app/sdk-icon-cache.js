import { sanitizeImageSrc } from "./format.js";
import { COMPONENT_SECTIONS } from "./report-model.js";
import libcheckerRulesCoreUrl from "@shared/generated/libchecker-rules-core.js?url";
import libcheckerRulesDetailUrl from "@shared/generated/libchecker-rules-detail.js?url";
import libcheckerSdkIconsUrl from "@shared/generated/libchecker-sdk-icons.js?url";

/** @typedef {import("@shared/contracts.js").ApkReport} ApkReport */
/** @typedef {import("@shared/contracts.js").LibCheckerRuleCore} LibCheckerRuleCore */
/** @typedef {import("@shared/contracts.js").LibCheckerRuleDetailMap} LibCheckerRuleDetailMap */
/** @typedef {import("@shared/contracts.js").SdkMarker} SdkMarker */
/** @typedef {import("@shared/contracts.js").SdkSummaryEntry} SdkSummaryEntry */
/** @typedef {{ byDetailKey: Map<string, import("@shared/contracts.js").LibCheckerRuleDetail>, byKey: Map<string, import("@shared/contracts.js").LibCheckerRuleDetail>, byLabel: Map<string, import("@shared/contracts.js").LibCheckerRuleDetail>, byTypedKey: Map<string, import("@shared/contracts.js").LibCheckerRuleDetail> }} SdkRuleDetailMap */

let sdkIconSvgMap = null;
let sdkIconSvgMapPromise = null;
let sdkSingleColorIconNames = null;
let sdkSingleColorIconNamesPromise = null;
let sdkRuleDetailMap = null;
let sdkRuleDetailMapPromise = null;
const sdkIconDataUriCache = new Map();
const GRADLE_FEATURE_ICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 1024 1024\" fill=\"none\"><path d=\"M868.5 255.6c-23.2-23.3-54.6-36.6-87.5-37.2-32.9-.5-64.7 11.7-88.7 34.1-1.2 1.2-2.2 2.6-2.9 4.1-.6 1.5-.9 3.2-.9 4.8 0 1.7.3 3.3.9 4.9.7 1.5 1.7 2.9 2.9 4l15.3 15.7c2 2 4.8 3.3 7.7 3.4 2.9.2 5.8-.6 8.1-2.4 14.6-11.7 33.3-17.3 51.9-15.6 18.7 1.7 36 10.6 48.3 24.7 12.4 14.2 18.7 32.6 17.8 51.3-.9 18.8-9.1 36.4-22.7 49.3C718 497.3 583.6 215.2 278.5 360.6c-5.2 2.5-9.7 6-13.5 10.3-3.7 4.4-6.5 9.4-8.1 14.9-1.7 5.5-2.2 11.2-1.6 16.9.7 5.7 2.5 11.1 5.4 16.1l52.4 90.4c5.4 9.4 14.3 16.3 24.8 19.2 10.5 2.9 21.7 1.5 31.2-3.9l1.2-.7-1 .7 23-12.8c25.8-16 50.3-34.3 73-54.5 2.3-2 5.2-3.2 8.2-3.3 3.1-.1 6.1.9 8.5 2.8 1.2 1.1 2.3 2.4 3 3.9.8 1.6 1.2 3.2 1.2 4.9.1 1.7-.2 3.3-.9 4.9-.6 1.5-1.6 2.9-2.8 4.1-24 21.6-49.8 41-77.2 58h-.8l-23.2 13c-9.8 5.5-20.8 8.4-32.1 8.4-11.6 0-23-3-33.1-8.8-10.1-5.8-18.5-14.1-24.4-24.2l-49.5-85.4c-94.6 67.3-152.8 196.8-121.3 360.7.5 2.7 2 5.2 4.1 7 2.2 1.8 4.9 2.8 7.7 2.8h55.8c3.1.1 6.1-1 8.4-3 2.3-2.1 3.7-4.9 4-8 2.6-19.8 12.4-38.1 27.4-51.3 15.1-13.2 34.4-20.4 54.5-20.4 20 0 39.3 7.2 54.4 20.4 15.1 13.2 24.8 31.5 27.4 51.3.4 2.9 1.8 5.6 4 7.6 2.2 1.9 5 3 7.9 3h54.6c2.9 0 5.8-1.1 8-3 2.1-2 3.6-4.7 3.9-7.6 2.6-19.8 12.4-38.1 27.5-51.3 15-13.2 34.4-20.4 54.4-20.4s39.4 7.2 54.4 20.4c15.1 13.2 24.8 31.5 27.5 51.3.3 2.9 1.7 5.6 3.9 7.6 2.2 1.9 5 3 8 3h54.2c3.2 0 6.2-1.2 8.5-3.5 2.2-2.2 3.5-5.2 3.6-8.4 1.2-76.5 21.8-164.3 80.6-208.3C969.2 433.2 915.6 302.7 868.5 255.6ZM661 485.5 622.1 466c0-4.1 1.1-8.2 3.1-11.8 2-3.7 5-6.7 8.5-8.9 3.5-2.2 7.6-3.4 11.7-3.6 4.2-.2 8.3.7 12 2.6 3.8 1.8 6.9 4.6 9.3 8.1 2.3 3.4 3.7 7.4 4.1 11.5.3 4.2-.4 8.4-2.1 12.1-1.7 3.8-4.4 7.1-7.7 9.6v-.1Z\" fill=\"#02303A\" /></svg>";
const BUILD_FEATURE_ICON_NAMES = {
  compose: "ic_lib_jetpack_compose",
  kotlin: "ic_lib_jetbrain_kmp",
};
const BUILD_FEATURE_ICON_SVGS = {
  agp: GRADLE_FEATURE_ICON_SVG,
  gradle: GRADLE_FEATURE_ICON_SVG,
};

/**
 * @param {ApkReport} report
 * @returns {Promise<ApkReport>}
 */
export async function hydrateReportSdkIcons(report) {
  const [iconMap, singleColorIconNames, ruleDetailMap] = await Promise.all([
    loadSdkIconSvgMap(),
    loadSdkSingleColorIconNames(),
    loadSdkRuleDetailMap(),
  ]);

  hydrateReportSdkIconTargets(report, iconMap, singleColorIconNames, ruleDetailMap);
  return report;
}

/**
 * @param {ApkReport} report
 * @returns {Promise<ApkReport>}
 */
export async function hydrateReportSdkIconImages(report) {
  const [iconMap, singleColorIconNames] = await Promise.all([
    loadSdkIconSvgMap(),
    loadSdkSingleColorIconNames(),
  ]);

  hydrateReportSdkIconTargets(report, iconMap, singleColorIconNames, null);
  return report;
}

/**
 * @param {ApkReport} report
 * @param {Record<string, string>} iconMap
 * @param {Set<string>} singleColorIconNames
 * @param {SdkRuleDetailMap | null} ruleDetailMap
 */
function hydrateReportSdkIconTargets(report, iconMap, singleColorIconNames, ruleDetailMap) {
  const info = report.apkInfo || {};
  hydrateBuildFeatureIcons(report, iconMap);
  hydrateSdkIconList(info.sdkSummary?.native, iconMap, singleColorIconNames, ruleDetailMap);
  hydrateSdkIconList(info.sdkSummary?.components, iconMap, singleColorIconNames, ruleDetailMap);

  for (const library of info.nativeLibraries || []) {
    hydrateSdkIcon(library.sdk, iconMap, singleColorIconNames, ruleDetailMap);
  }

  for (const sectionName of COMPONENT_SECTIONS) {
    for (const component of info.components?.[sectionName] || []) {
      hydrateSdkIcon(component.sdk, iconMap, singleColorIconNames, ruleDetailMap);
    }
  }
}

function hydrateBuildFeatureIcons(report, iconMap) {
  if (!report || typeof report !== "object") {
    return;
  }

  const featureIcons = report.featureIcons && typeof report.featureIcons === "object"
    ? report.featureIcons
    : {};
  for (const key of [...Object.keys(BUILD_FEATURE_ICON_NAMES), ...Object.keys(BUILD_FEATURE_ICON_SVGS)]) {
    if (!sanitizeImageSrc(featureIcons[key] || "")) {
      featureIcons[key] = resolveBuildFeatureIconDataUri(key, iconMap);
    }
  }
  report.featureIcons = featureIcons;
}

/**
 * @param {ApkReport} report
 * @returns {Promise<ApkReport>}
 */
export async function hydrateReportSdkRuleDetails(report) {
  const ruleDetailMap = await loadSdkRuleDetailMap();
  const info = report.apkInfo || {};
  hydrateSdkRuleDetailList(info.sdkSummary?.native, ruleDetailMap);
  hydrateSdkRuleDetailList(info.sdkSummary?.components, ruleDetailMap);

  for (const library of info.nativeLibraries || []) {
    hydrateSdkRuleDetail(library.sdk, ruleDetailMap);
  }

  for (const sectionName of COMPONENT_SECTIONS) {
    for (const component of info.components?.[sectionName] || []) {
      hydrateSdkRuleDetail(component.sdk, ruleDetailMap);
    }
  }

  return report;
}

async function loadSdkIconSvgMap() {
  if (sdkIconSvgMap) {
    return sdkIconSvgMap;
  }

  if (!sdkIconSvgMapPromise) {
    sdkIconSvgMapPromise = import(/* @vite-ignore */ libcheckerSdkIconsUrl)
      .then((module) => module.LIBCHECKER_SDK_ICON_SVGS || {})
      .catch(() => ({}));
  }

  sdkIconSvgMap = await sdkIconSvgMapPromise;
  return sdkIconSvgMap;
}

async function loadSdkSingleColorIconNames() {
  if (sdkSingleColorIconNames) {
    return sdkSingleColorIconNames;
  }

  if (!sdkSingleColorIconNamesPromise) {
    sdkSingleColorIconNamesPromise = import(/* @vite-ignore */ libcheckerRulesCoreUrl)
      .then((module) => buildSdkSingleColorIconNameSet(module.LIBCHECKER_RULES_CORE || []))
      .catch(() => new Set());
  }

  sdkSingleColorIconNames = await sdkSingleColorIconNamesPromise;
  return sdkSingleColorIconNames;
}

/** @param {readonly LibCheckerRuleCore[]} rules */
function buildSdkSingleColorIconNameSet(rules) {
  const iconNames = new Set();
  for (const rule of rules) {
    if (rule.singleColorIcon && rule.iconName) {
      iconNames.add(rule.iconName);
    }
  }
  return iconNames;
}

async function loadSdkRuleDetailMap() {
  if (sdkRuleDetailMap) {
    return sdkRuleDetailMap;
  }

  if (!sdkRuleDetailMapPromise) {
    sdkRuleDetailMapPromise = Promise.all([
      import(/* @vite-ignore */ libcheckerRulesCoreUrl),
      import(/* @vite-ignore */ libcheckerRulesDetailUrl),
    ])
      .then(([rulesModule, detailsModule]) => buildSdkRuleDetailMap(
        rulesModule.LIBCHECKER_RULES_CORE || [],
        detailsModule.LIBCHECKER_RULE_DETAILS || {},
      ))
      .catch(() => createEmptyRuleDetailMap());
  }

  sdkRuleDetailMap = await sdkRuleDetailMapPromise;
  return sdkRuleDetailMap;
}

/**
 * @param {SdkSummaryEntry[]} entries
 * @param {Record<string, string>} iconMap
 * @param {Set<string>} singleColorIconNames
 * @param {SdkRuleDetailMap | null} ruleDetailMap
 */
function hydrateSdkIconList(entries = [], iconMap, singleColorIconNames, ruleDetailMap) {
  for (const entry of entries) {
    hydrateSdkIcon(entry, iconMap, singleColorIconNames, ruleDetailMap);
  }
}

/**
 * @param {SdkSummaryEntry[]} entries
 * @param {SdkRuleDetailMap | null} ruleDetailMap
 */
function hydrateSdkRuleDetailList(entries = [], ruleDetailMap) {
  for (const entry of entries) {
    hydrateSdkRuleDetail(entry, ruleDetailMap);
  }
}

/**
 * @param {SdkMarker | SdkSummaryEntry | null | undefined} sdk
 * @param {Record<string, string>} iconMap
 * @param {Set<string>} [singleColorIconNames]
 * @param {SdkRuleDetailMap | null} [ruleDetailMap]
 */
function hydrateSdkIcon(sdk, iconMap, singleColorIconNames = new Set(), ruleDetailMap = null) {
  if (!sdk || typeof sdk !== "object") {
    return;
  }

  hydrateSdkRuleDetail(sdk, ruleDetailMap);

  if (typeof sdk.singleColorIcon !== "boolean") {
    sdk.singleColorIcon = Boolean(sdk.iconName && singleColorIconNames.has(sdk.iconName));
  }

  if (sanitizeImageSrc(sdk.iconUrl || "")) {
    return;
  }

  sdk.iconUrl = resolveSdkIconDataUri(sdk.iconName, iconMap);
}

/**
 * @param {SdkMarker | SdkSummaryEntry | null | undefined} sdk
 * @param {SdkRuleDetailMap | null} [ruleDetailMap]
 */
function hydrateSdkRuleDetail(sdk, ruleDetailMap = null) {
  if (!sdk || typeof sdk !== "object" || sdk.ruleDetail) {
    return;
  }

  sdk.ruleDetail = resolveSdkRuleDetail(sdk, ruleDetailMap);
}

/**
 * @param {readonly LibCheckerRuleCore[]} rules
 * @param {LibCheckerRuleDetailMap} detailsByDetailKey
 */
function buildSdkRuleDetailMap(rules, detailsByDetailKey) {
  const byDetailKey = new Map();
  const byKey = new Map();
  const byLabel = new Map();
  const byTypedKey = new Map();
  for (const rule of rules) {
    const detailKey = buildGeneratedRuleDetailKey(rule);
    const ruleDetail = detailKey ? detailsByDetailKey[detailKey] : null;
    if (!ruleDetail || !rule.label) {
      continue;
    }

    byDetailKey.set(detailKey, ruleDetail);

    if (!byLabel.has(rule.label)) {
      byLabel.set(rule.label, ruleDetail);
    }

    const key = buildSdkRuleDetailKey(rule);
    if (key && !byKey.has(key)) {
      byKey.set(key, ruleDetail);
    }

    const typedKey = buildSdkTypedRuleDetailKey(rule);
    if (typedKey && !byTypedKey.has(typedKey)) {
      byTypedKey.set(typedKey, ruleDetail);
    }
  }

  return { byDetailKey, byKey, byLabel, byTypedKey };
}

function resolveSdkRuleDetail(sdk, ruleDetailMap) {
  if (!ruleDetailMap) {
    return null;
  }

  if (sdk?.detailKey && ruleDetailMap.byDetailKey.has(sdk.detailKey)) {
    return ruleDetailMap.byDetailKey.get(sdk.detailKey);
  }

  const typedKey = buildSdkTypedRuleDetailKey(sdk);
  if (typedKey && ruleDetailMap.byTypedKey.has(typedKey)) {
    return ruleDetailMap.byTypedKey.get(typedKey);
  }

  const key = buildSdkRuleDetailKey(sdk);
  if (key && ruleDetailMap.byKey.has(key)) {
    return ruleDetailMap.byKey.get(key);
  }

  if (sdk?.label && ruleDetailMap.byLabel.has(sdk.label)) {
    return ruleDetailMap.byLabel.get(sdk.label);
  }

  return null;
}

function createEmptyRuleDetailMap() {
  return { byDetailKey: new Map(), byKey: new Map(), byLabel: new Map(), byTypedKey: new Map() };
}

function buildSdkRuleDetailKey(sdk) {
  if (!sdk?.label || !sdk.iconName) {
    return "";
  }

  return `${sdk.label}::${sdk.iconName}`;
}

function buildSdkTypedRuleDetailKey(sdk) {
  if (sdk?.type == null) {
    return "";
  }

  const key = buildSdkRuleDetailKey(sdk);
  return key ? `${sdk.type}::${key}` : "";
}

function buildGeneratedRuleDetailKey(rule) {
  if (!rule || !Number.isFinite(rule.type)) {
    return "";
  }

  if (rule.isRegexRule && rule.regexName) {
    return `${rule.type}::regex/${rule.regexName}`;
  }

  return rule.name ? `${rule.type}::${rule.name}` : "";
}

function resolveBuildFeatureIconDataUri(key, iconMap) {
  const svg = BUILD_FEATURE_ICON_SVGS[key];
  return svg ? resolveIconDataUri(`feature:${key}`, svg) : resolveSdkIconDataUri(BUILD_FEATURE_ICON_NAMES[key], iconMap);
}

function resolveSdkIconDataUri(iconName, iconMap) {
  const cacheKey = iconName || "ic_sdk_placeholder";
  if (sdkIconDataUriCache.has(cacheKey)) {
    return sdkIconDataUriCache.get(cacheKey);
  }

  const svg = iconMap?.[iconName] || iconMap?.ic_sdk_placeholder;
  if (!svg) {
    sdkIconDataUriCache.set(cacheKey, "");
    return "";
  }

  return resolveIconDataUri(cacheKey, svg);
}

function resolveIconDataUri(cacheKey, svg) {
  if (sdkIconDataUriCache.has(cacheKey)) {
    return sdkIconDataUriCache.get(cacheKey);
  }

  const dataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  sdkIconDataUriCache.set(cacheKey, dataUri);
  return dataUri;
}
