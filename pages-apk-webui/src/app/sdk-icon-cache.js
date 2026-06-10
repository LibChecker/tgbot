import { sanitizeImageSrc } from "./format.js";
import { COMPONENT_SECTIONS } from "./report-model.js";
import libcheckerRulesUrl from "@shared/generated/libchecker-rules.js?url";
import libcheckerSdkIconsUrl from "@shared/generated/libchecker-sdk-icons.js?url";

let sdkIconSvgMap = null;
let sdkIconSvgMapPromise = null;
let sdkSingleColorIconNames = null;
let sdkSingleColorIconNamesPromise = null;
let sdkRuleDetailMap = null;
let sdkRuleDetailMapPromise = null;
const sdkIconDataUriCache = new Map();

export async function hydrateReportSdkIcons(report) {
  const [iconMap, singleColorIconNames, ruleDetailMap] = await Promise.all([
    loadSdkIconSvgMap(),
    loadSdkSingleColorIconNames(),
    loadSdkRuleDetailMap(),
  ]);
  if (!Object.keys(iconMap).length) {
    return report;
  }

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
    sdkSingleColorIconNamesPromise = import(/* @vite-ignore */ libcheckerRulesUrl)
      .then((module) => buildSdkSingleColorIconNameSet(module.LIBCHECKER_RULES || []))
      .catch(() => new Set());
  }

  sdkSingleColorIconNames = await sdkSingleColorIconNamesPromise;
  return sdkSingleColorIconNames;
}

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
    sdkRuleDetailMapPromise = import(/* @vite-ignore */ libcheckerRulesUrl)
      .then((module) => buildSdkRuleDetailMap(module.LIBCHECKER_RULES || []))
      .catch(() => ({ byKey: new Map(), byLabel: new Map(), byTypedKey: new Map() }));
  }

  sdkRuleDetailMap = await sdkRuleDetailMapPromise;
  return sdkRuleDetailMap;
}

function hydrateSdkIconList(entries = [], iconMap, singleColorIconNames, ruleDetailMap) {
  for (const entry of entries) {
    hydrateSdkIcon(entry, iconMap, singleColorIconNames, ruleDetailMap);
  }
}

function hydrateSdkIcon(sdk, iconMap, singleColorIconNames = new Set(), ruleDetailMap = null) {
  if (!sdk || typeof sdk !== "object") {
    return;
  }

  if (!sdk.ruleDetail) {
    sdk.ruleDetail = resolveSdkRuleDetail(sdk, ruleDetailMap);
  }

  if (typeof sdk.singleColorIcon !== "boolean") {
    sdk.singleColorIcon = Boolean(sdk.iconName && singleColorIconNames.has(sdk.iconName));
  }

  if (sanitizeImageSrc(sdk.iconUrl || "")) {
    return;
  }

  sdk.iconUrl = resolveSdkIconDataUri(sdk.iconName, iconMap);
}

function buildSdkRuleDetailMap(rules) {
  const byKey = new Map();
  const byLabel = new Map();
  const byTypedKey = new Map();
  for (const rule of rules) {
    if (!rule?.ruleDetail || !rule.label) {
      continue;
    }

    if (!byLabel.has(rule.label)) {
      byLabel.set(rule.label, rule.ruleDetail);
    }

    const key = buildSdkRuleDetailKey(rule);
    if (key && !byKey.has(key)) {
      byKey.set(key, rule.ruleDetail);
    }

    const typedKey = buildSdkTypedRuleDetailKey(rule);
    if (typedKey && !byTypedKey.has(typedKey)) {
      byTypedKey.set(typedKey, rule.ruleDetail);
    }
  }

  return { byKey, byLabel, byTypedKey };
}

function resolveSdkRuleDetail(sdk, ruleDetailMap) {
  if (!ruleDetailMap) {
    return null;
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
