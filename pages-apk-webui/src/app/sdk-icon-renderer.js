import { sanitizeImageSrc } from "./format.js";
import { escapeAttr, escapeHtml } from "./html.js";

export function renderSdkChip(sdk, unknownLabel = "Unknown") {
  return `<span class="chip">${renderSdkIcon(sdk.iconUrl, sdk.label, sdk.singleColorIcon)}${escapeHtml(sdk.label || unknownLabel)}</span>`;
}

export function renderSdkInline(sdk, unknownLabel = "Unknown") {
  return `<span class="sdk-inline">${renderSdkIcon(sdk.iconUrl, sdk.label, sdk.singleColorIcon)}<span>${escapeHtml(sdk.label || unknownLabel)}</span></span>`;
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

function renderThemedSdkIconSvg(src) {
  const svgText = decodeSvgDataUri(src);
  if (
    !svgText ||
    typeof DOMParser !== "function" ||
    typeof XMLSerializer !== "function" ||
    /<(?:script|foreignObject)\b|javascript:/iu.test(svgText)
  ) {
    return "";
  }

  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = document.documentElement;
  if (document.querySelector("parsererror") || !svg || svg.localName.toLowerCase() !== "svg") {
    return "";
  }

  svg.setAttribute("class", "sdk-icon__svg");
  svg.removeAttribute("width");
  svg.removeAttribute("height");

  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes)) {
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

  return new XMLSerializer().serializeToString(svg);
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

  const declarations = style
    .split(";")
    .map((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 0) {
        return declaration.trim();
      }

      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if ((property.toLowerCase() === "fill" || property.toLowerCase() === "stroke") && isThemeablePaintValue(value)) {
        return `${property}: currentColor`;
      }

      return value ? `${property}: ${value}` : "";
    })
    .filter(Boolean);

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
