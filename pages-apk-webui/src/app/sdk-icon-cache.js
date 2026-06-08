import { sanitizeImageSrc } from "./format.js";
import { COMPONENT_SECTIONS } from "./report-model.js";

let sdkIconSvgMap = null;
let sdkIconSvgMapPromise = null;
let sdkSingleColorIconNames = null;
let sdkSingleColorIconNamesPromise = null;

export async function hydrateReportSdkIcons(report) {
  const [iconMap, singleColorIconNames] = await Promise.all([
    loadSdkIconSvgMap(),
    loadSdkSingleColorIconNames(),
  ]);
  if (!Object.keys(iconMap).length) {
    return report;
  }

  const info = report.apkInfo || {};
  hydrateSdkIconList(info.sdkSummary?.native, iconMap, singleColorIconNames);
  hydrateSdkIconList(info.sdkSummary?.components, iconMap, singleColorIconNames);

  for (const library of info.nativeLibraries || []) {
    hydrateSdkIcon(library.sdk, iconMap, singleColorIconNames);
  }

  for (const sectionName of COMPONENT_SECTIONS) {
    for (const component of info.components?.[sectionName] || []) {
      hydrateSdkIcon(component.sdk, iconMap, singleColorIconNames);
    }
  }

  return report;
}

async function loadSdkIconSvgMap() {
  if (sdkIconSvgMap) {
    return sdkIconSvgMap;
  }

  if (!sdkIconSvgMapPromise) {
    sdkIconSvgMapPromise = import("../modules/generated/libchecker-sdk-icons.js")
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
    sdkSingleColorIconNamesPromise = import("../modules/generated/libchecker-rules.js")
      .then((module) => new Set(
        (module.LIBCHECKER_RULES || [])
          .filter((rule) => rule.singleColorIcon && rule.iconName)
          .map((rule) => rule.iconName),
      ))
      .catch(() => new Set());
  }

  sdkSingleColorIconNames = await sdkSingleColorIconNamesPromise;
  return sdkSingleColorIconNames;
}

function hydrateSdkIconList(entries = [], iconMap, singleColorIconNames) {
  for (const entry of entries) {
    hydrateSdkIcon(entry, iconMap, singleColorIconNames);
  }
}

function hydrateSdkIcon(sdk, iconMap, singleColorIconNames = new Set()) {
  if (!sdk || typeof sdk !== "object") {
    return;
  }

  if (typeof sdk.singleColorIcon !== "boolean") {
    sdk.singleColorIcon = Boolean(sdk.iconName && singleColorIconNames.has(sdk.iconName));
  }

  if (sanitizeImageSrc(sdk.iconUrl || "")) {
    return;
  }

  sdk.iconUrl = resolveSdkIconDataUri(sdk.iconName, iconMap);
}

function resolveSdkIconDataUri(iconName, iconMap) {
  const svg = iconMap?.[iconName] || iconMap?.ic_sdk_placeholder;
  if (!svg) {
    return "";
  }

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
