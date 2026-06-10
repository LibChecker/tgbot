import { sanitizeImageSrc } from "./format.js";
import { escapeAttr, escapeHtml } from "./html.js";

/** @typedef {import("@shared/contracts.js").LibCheckerRuleDetail} LibCheckerRuleDetail */
/** @typedef {import("@shared/contracts.js").SdkMarker} SdkMarker */

const ruleDetailsById = new Map();
const ruleDetailIdsByPayload = new Map();
const ruleDetailIdsByRuleKey = new Map();
const ruleDetailIdsByObject = new WeakMap();
const themedSvgBySrc = new Map();
let ruleDetailIdSeed = 0;

/**
 * @param {SdkMarker} sdk
 * @param {string} [unknownLabel]
 */
export function renderSdkChip(sdk, unknownLabel = "Unknown") {
  return `<span class="chip">${renderSdkIcon(sdk.iconUrl, sdk.label, sdk.singleColorIcon)}${renderSdkRuleLabel(sdk, unknownLabel)}</span>`;
}

/**
 * @param {SdkMarker} sdk
 * @param {string} [unknownLabel]
 */
export function renderSdkInline(sdk, unknownLabel = "Unknown") {
  return `<span class="sdk-inline">${renderSdkIcon(sdk.iconUrl, sdk.label, sdk.singleColorIcon)}${renderSdkRuleLabel(sdk, unknownLabel)}</span>`;
}

/**
 * @param {SdkMarker | null | undefined} sdk
 * @param {string} [unknownLabel]
 */
export function renderSdkRuleLabel(sdk, unknownLabel = "Unknown") {
  const label = sdk?.label || unknownLabel;
  const detailId = registerRuleDetail(sdk?.ruleDetail, sdk);
  const detailAttrs = detailId
    ? ` data-rule-detail-id="${escapeAttr(detailId)}" tabindex="0" aria-haspopup="dialog"`
    : "";
  const detailClass = detailId ? " has-rule-detail" : "";
  return `<span class="sdk-rule-label${detailClass}"${detailAttrs}>${escapeHtml(label)}</span>`;
}

/**
 * @param {string} detailId
 * @returns {LibCheckerRuleDetail | null}
 */
export function getRegisteredSdkRuleDetail(detailId) {
  return ruleDetailsById.get(String(detailId || "")) || null;
}

export function renderSdkIcon(src, label, singleColorIcon = false) {
  const safeSrc = sanitizeImageSrc(src || "");
  if (!safeSrc) {
    return "";
  }

  if (singleColorIcon) {
    const themedSvg = renderThemedSdkIconSvg(safeSrc);
    if (themedSvg) {
      return `<span class="sdk-icon sdk-icon--mono" aria-hidden="true">${themedSvg}</span>`;
    }
  }

  return `<span class="sdk-icon"><img class="sdk-icon__image" src="${escapeAttr(safeSrc)}" alt="${escapeAttr(label || "")}"></span>`;
}

function registerRuleDetail(ruleDetail, sdk = null) {
  if (!ruleDetail || typeof ruleDetail !== "object") {
    return "";
  }

  const objectId = ruleDetailIdsByObject.get(ruleDetail);
  if (objectId) {
    return objectId;
  }

  const ruleKey = buildRuleDetailKey(sdk);
  if (ruleKey) {
    const existingRuleId = ruleDetailIdsByRuleKey.get(ruleKey);
    if (existingRuleId) {
      ruleDetailIdsByObject.set(ruleDetail, existingRuleId);
      return existingRuleId;
    }
  }

  let payload = "";
  try {
    payload = JSON.stringify(ruleDetail);
  } catch {
    return "";
  }

  if (!payload || payload === "{}") {
    return "";
  }

  const existingId = ruleDetailIdsByPayload.get(payload);
  if (existingId) {
    ruleDetailIdsByObject.set(ruleDetail, existingId);
    return existingId;
  }

  ruleDetailIdSeed += 1;
  const detailId = `rule-detail-${ruleDetailIdSeed}`;
  ruleDetailIdsByObject.set(ruleDetail, detailId);
  if (ruleKey) {
    ruleDetailIdsByRuleKey.set(ruleKey, detailId);
  }
  ruleDetailIdsByPayload.set(payload, detailId);
  ruleDetailsById.set(detailId, ruleDetail);
  return detailId;
}

function buildRuleDetailKey(sdk) {
  if (!sdk?.label || !sdk.iconName) {
    return "";
  }

  return `${sdk.type ?? ""}::${sdk.label}::${sdk.iconName}`;
}

function renderThemedSdkIconSvg(src) {
  if (themedSvgBySrc.has(src)) {
    return themedSvgBySrc.get(src);
  }

  const cacheResult = (value) => {
    themedSvgBySrc.set(src, value);
    return value;
  };

  const svgText = decodeSvgDataUri(src);
  if (
    !svgText ||
    typeof DOMParser !== "function" ||
    typeof XMLSerializer !== "function" ||
    /<(?:script|foreignObject)\b|javascript:/iu.test(svgText)
  ) {
    return cacheResult("");
  }

  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = document.documentElement;
  if (document.querySelector("parsererror") || !svg || svg.localName.toLowerCase() !== "svg") {
    return cacheResult("");
  }

  svg.setAttribute("class", "sdk-icon__svg");
  svg.removeAttribute("width");
  svg.removeAttribute("height");

  themeSvgElement(svg);
  for (const element of svg.querySelectorAll("*")) {
    themeSvgElement(element);
  }

  return cacheResult(new XMLSerializer().serializeToString(svg));
}

function themeSvgElement(element) {
  for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
    const attribute = element.attributes[index];
    const name = attribute.name.toLowerCase();
    const value = attribute.value;
    if (name.startsWith("on") || /javascript:/iu.test(value)) {
      element.removeAttribute(attribute.name);
    }
  }

  themeSvgPaintAttribute(element, "fill");
  themeSvgPaintAttribute(element, "stroke");
  themeSvgInlineStyle(element);
}

function decodeSvgDataUri(src) {
  const value = String(src || "");
  const match = value.match(/^data:image\/svg\+xml(?:;[^,]*)?,(.*)$/iu);
  if (!match) {
    return "";
  }

  const meta = value.slice(0, value.indexOf(",")).toLowerCase();
  try {
    if (meta.includes(";base64")) {
      const binary = atob(match[1]);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function themeSvgPaintAttribute(element, attributeName) {
  const value = element.getAttribute(attributeName);
  if (isThemeablePaintValue(value)) {
    element.setAttribute(attributeName, "currentColor");
  }
}

function themeSvgInlineStyle(element) {
  const style = element.getAttribute("style");
  if (!style) {
    return;
  }

  const declarations = [];
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) {
      const trimmed = declaration.trim();
      if (trimmed) {
        declarations.push(trimmed);
      }
      continue;
    }

    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if ((property.toLowerCase() === "fill" || property.toLowerCase() === "stroke") && isThemeablePaintValue(value)) {
      declarations.push(`${property}: currentColor`);
    } else if (value) {
      declarations.push(`${property}: ${value}`);
    }
  }

  if (declarations.length) {
    element.setAttribute("style", declarations.join("; "));
  } else {
    element.removeAttribute("style");
  }
}

function isThemeablePaintValue(value) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return (
    normalized !== "none" &&
    normalized !== "transparent" &&
    normalized !== "currentcolor" &&
    !normalized.startsWith("url(")
  );
}
