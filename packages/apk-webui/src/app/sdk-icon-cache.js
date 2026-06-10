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

  const info = report.apkInfo || {};
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

  return report;
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

  const dataUri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  sdkIconDataUriCache.set(cacheKey, dataUri);
  return dataUri;
}
