import { BUILD_FEATURE_ICON_NAMES } from "../../shared/src/build-feature-icons.js";

const SVG_HEADERS = {
  "content-type": "image/svg+xml; charset=UTF-8",
  "cache-control": "public, max-age=300",
};

const ICON_VERSION = "libchecker-20260412";
const SDK_ICON_VERSION = "libchecker-rules-20260412";
let sdkIconSvgMapPromise = null;

export function handleIconRequest(pathname) {
  const featureIconName = pathname.match(/^\/assets\/icons\/([a-z0-9_-]+)\.svg$/u)?.[1];
  if (featureIconName) {
    const sdkIconName = BUILD_FEATURE_ICON_NAMES[featureIconName];
    return sdkIconName
      ? handleGeneratedIconRequest(sdkIconName)
      : new Response("Not Found", { status: 404 });
  }

  const sdkIconName = pathname.match(/^\/assets\/sdk-icons\/([a-z0-9_-]+)\.svg$/u)?.[1];
  if (!sdkIconName) {
    return null;
  }

  return handleGeneratedIconRequest(sdkIconName);
}

async function handleGeneratedIconRequest(iconName) {
  const svgMap = await loadSdkIconSvgMap();
  const svg = svgMap[iconName];
  if (!svg) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(svg, {
    headers: SVG_HEADERS,
  });
}

export function buildFeatureIconUrl(baseUrl, name) {
  return `${baseUrl.replace(/\/+$/u, "")}/assets/icons/${name}.svg?v=${ICON_VERSION}`;
}

export function buildSdkIconUrl(baseUrl, iconName) {
  return `${baseUrl.replace(/\/+$/u, "")}/assets/sdk-icons/${iconName}.svg?v=${SDK_ICON_VERSION}`;
}

function loadSdkIconSvgMap() {
  if (!sdkIconSvgMapPromise) {
    sdkIconSvgMapPromise = import("../../shared/src/generated/libchecker-sdk-icons.js")
      .then((module) => module.LIBCHECKER_SDK_ICON_SVGS)
      .catch((error) => {
        sdkIconSvgMapPromise = null;
        throw error;
      });
  }

  return sdkIconSvgMapPromise;
}
