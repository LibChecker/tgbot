import { sanitizeImageSrc } from "./format.js";
import { clamp } from "./math.js";

const DOT_TITLE_GLYPHS = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "?": ["11111", "00001", "00010", "00100", "00100", "00000", "00100"],
};

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

export function renderBrandTitle(node, fallbackTitle) {
  if (!node) {
    return;
  }

  const title = node.dataset.dotTitle || fallbackTitle || "LibChecker WebUI";
  node.textContent = "";
  node.classList.add("is-dot-rendered");
  node.setAttribute("aria-label", title);

  node.append(
    buildBrandTitleLayer(title, "brand-title__layer brand-title__layer--base", false),
    buildBrandTitleLayer(title, "brand-title__layer brand-title__layer--color", true),
  );
}

function buildBrandTitleLayer(title, className, colorized) {
  const layerNode = document.createElement("span");
  layerNode.className = className;
  layerNode.setAttribute("aria-hidden", "true");
  let activeDotIndex = 0;

  title.split(" ").forEach((word) => {
    if (!word) {
      return;
    }

    const wordNode = document.createElement("span");
    wordNode.className = "brand-title__word";

    Array.from(word.toUpperCase()).forEach((character) => {
      const glyph = DOT_TITLE_GLYPHS[character] || DOT_TITLE_GLYPHS["?"];
      const letterNode = document.createElement("span");
      letterNode.className = "brand-title__letter";

      glyph.forEach((row) => {
        Array.from(row).forEach((dot) => {
          const dotNode = document.createElement("span");
          dotNode.className = dot === "1" ? "brand-title__dot is-on" : "brand-title__dot";
          if (colorized && dot === "1") {
            dotNode.style.setProperty("--dot-hue", String(Math.round((210 + activeDotIndex * 3.1) % 360)));
            activeDotIndex += 1;
          }
          letterNode.append(dotNode);
        });
      });

      wordNode.append(letterNode);
    });

    layerNode.append(wordNode);
  });

  return layerNode;
}

export function initBrandTitleColorMask(node) {
  if (!node) {
    return;
  }

  const updateMask = (event) => {
    const rect = node.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const y = clamp(event.clientY - rect.top, 0, rect.height);
    node.style.setProperty("--brand-title-mask-x", `${x.toFixed(1)}px`);
    node.style.setProperty("--brand-title-mask-y", `${y.toFixed(1)}px`);
    node.classList.add("is-color-mask-active");
  };

  node.addEventListener("pointerenter", updateMask);
  node.addEventListener("pointermove", updateMask);
  node.addEventListener("pointerleave", () => {
    node.classList.remove("is-color-mask-active");
  });
}

export function initAppTitleColorMask(root, info) {
  const node = root?.querySelector("[data-app-title-mask]");
  if (!node) {
    return;
  }

  const updateMask = (event) => {
    const rect = node.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const y = clamp(event.clientY - rect.top, 0, rect.height);
    node.style.setProperty("--app-title-mask-x", `${x.toFixed(1)}px`);
    node.style.setProperty("--app-title-mask-y", `${y.toFixed(1)}px`);
    node.classList.add("is-color-mask-active");
  };

  node.addEventListener("pointerenter", updateMask);
  node.addEventListener("pointermove", updateMask);
  node.addEventListener("pointerleave", () => {
    node.classList.remove("is-color-mask-active");
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

function extractAppIconHue(info) {
  const src = sanitizeImageSrc(info?.icon?.dataUri || "");
  if (!src || typeof Image !== "function") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const hue = sampleDominantHue(image);
        resolve(hue);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
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
