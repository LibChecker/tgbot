import { sanitizeImageSrc } from "./format.js";
import { clamp } from "./math.js";

const POINTER_MASK_EVENT_OPTIONS = { passive: true };
const ICON_HUE_CACHE_KEY = "__lcDominantHue";
const ICON_HUE_CACHE_MISS_KEY = "__lcDominantHueMiss";

export function initAppTitleColorMask(root, info) {
  const node = root?.querySelector("[data-app-title-mask]");
  if (!node) {
    return;
  }

  initColorMaskPointerTracking(node, {
    styleNode: node.querySelector(".app-title-mask__color"),
    xProperty: "--app-title-mask-x",
    yProperty: "--app-title-mask-y",
  });

  extractAppIconHue(info).then((hue) => {
    if (hue == null || !node.isConnected) {
      return;
    }

    node.style.setProperty("--app-title-hue", String(Math.round(hue)));
  }).catch(() => {
    // The default accent hue is good enough if canvas sampling is unavailable.
  });
}

function initColorMaskPointerTracking(node, { styleNode, xProperty, yProperty }) {
  const target = styleNode || node;
  if (!target) {
    return;
  }

  let rect = null;
  let frameId = 0;
  let pendingClientX = 0;
  let pendingClientY = 0;
  let lastX = "";
  let lastY = "";

  const readRect = () => {
    rect = node.getBoundingClientRect();
  };

  const applyMask = () => {
    frameId = 0;
    if (!node.isConnected || !target.isConnected) {
      return;
    }

    if (!rect) {
      readRect();
    }

    const x = clamp(pendingClientX - rect.left, 0, rect.width);
    const y = clamp(pendingClientY - rect.top, 0, rect.height);
    const nextX = `${x.toFixed(1)}px`;
    const nextY = `${y.toFixed(1)}px`;

    if (nextX !== lastX) {
      target.style.setProperty(xProperty, nextX);
      lastX = nextX;
    }
    if (nextY !== lastY) {
      target.style.setProperty(yProperty, nextY);
      lastY = nextY;
    }

    node.classList.add("is-color-mask-active");
  };

  const scheduleMaskUpdate = (event) => {
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    if (!frameId) {
      frameId = requestAnimationFrame(applyMask);
    }
  };

  const handlePointerEnter = (event) => {
    readRect();
    scheduleMaskUpdate(event);
  };

  const handlePointerLeave = () => {
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    rect = null;
    lastX = "";
    lastY = "";
    node.classList.remove("is-color-mask-active");
  };

  node.addEventListener("pointerenter", handlePointerEnter, POINTER_MASK_EVENT_OPTIONS);
  node.addEventListener("pointermove", scheduleMaskUpdate, POINTER_MASK_EVENT_OPTIONS);
  node.addEventListener("pointerleave", handlePointerLeave, POINTER_MASK_EVENT_OPTIONS);
}

function extractAppIconHue(info) {
  const icon = info?.icon;
  if (Object.prototype.hasOwnProperty.call(icon || {}, ICON_HUE_CACHE_KEY)) {
    return Promise.resolve(icon[ICON_HUE_CACHE_KEY]);
  }
  if (Object.prototype.hasOwnProperty.call(icon || {}, ICON_HUE_CACHE_MISS_KEY)) {
    return Promise.resolve(null);
  }

  const src = sanitizeImageSrc(icon?.dataUri || "");
  if (!src || typeof Image !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const hue = sampleDominantHue(image);
        cacheIconHue(icon, hue);
        resolve(hue);
      } catch {
        cacheIconHue(icon, null);
        resolve(null);
      }
    };
    image.onerror = () => {
      cacheIconHue(icon, null);
      resolve(null);
    };
    image.src = src;
  });
}

function cacheIconHue(icon, hue) {
  if (!icon || typeof icon !== "object") {
    return;
  }

  try {
    if (hue == null) {
      Object.defineProperty(icon, ICON_HUE_CACHE_MISS_KEY, {
        value: true,
        configurable: true,
      });
      return;
    }

    Object.defineProperty(icon, ICON_HUE_CACHE_KEY, {
      value: hue,
      configurable: true,
    });
  } catch {
    // Icon hue caching is a performance hint; rendering should not depend on it.
  }
}

function sampleDominantHue(image) {
  const canvas = document.createElement("canvas");
  const size = 36;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  let vectorX = 0;
  let vectorY = 0;
  let totalWeight = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha < 0.18) {
      continue;
    }

    const hsl = rgbToHsl({
      r: pixels[index],
      g: pixels[index + 1],
      b: pixels[index + 2],
    });
    if (hsl.l < 0.05 || hsl.l > 0.96 || hsl.s < 0.08) {
      continue;
    }

    const lightnessWeight = 1 - Math.min(0.65, Math.abs(hsl.l - 0.54));
    const weight = alpha * (0.25 + hsl.s) ** 1.55 * lightnessWeight;
    const radians = (hsl.h * Math.PI) / 180;
    vectorX += Math.cos(radians) * weight;
    vectorY += Math.sin(radians) * weight;
    totalWeight += weight;
  }

  if (totalWeight < 0.01) {
    return null;
  }

  return (Math.atan2(vectorY, vectorX) * 180 / Math.PI + 360) % 360;
}

function rgbToHsl(color) {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = ((b - r) / delta) + 2;
  } else {
    hue = ((r - g) / delta) + 4;
  }

  return {
    h: (hue * 60 + 360) % 360,
    s: saturation,
    l: lightness,
  };
}
