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

const BRAND_TITLE_MASK_DEFAULT_RADIUS = 84;
const BRAND_TITLE_CANVAS_DPR_LIMIT = 2;
const POINTER_MASK_EVENT_OPTIONS = { passive: true };

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
    buildBrandTitleLayer(title, "brand-title__layer brand-title__layer--base"),
    buildBrandTitleCanvas(),
  );
}

function buildBrandTitleLayer(title, className) {
  const layerNode = document.createElement("span");
  layerNode.className = className;
  layerNode.setAttribute("aria-hidden", "true");

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
          letterNode.append(dotNode);
        });
      });

      wordNode.append(letterNode);
    });

    layerNode.append(wordNode);
  });

  return layerNode;
}

function buildBrandTitleCanvas() {
  const canvas = document.createElement("canvas");
  canvas.className = "brand-title__color-canvas";
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}

export function initBrandTitleColorMask(node) {
  if (!node) {
    return;
  }

  const canvas = node.querySelector(".brand-title__color-canvas");
  const baseLayer = node.querySelector(".brand-title__layer--base");
  const context = canvas?.getContext?.("2d", { alpha: true });
  if (!canvas || !baseLayer || !context) {
    return;
  }

  initBrandTitleCanvasMask(node, canvas, context, baseLayer);
}

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

function initBrandTitleCanvasMask(node, canvas, context, baseLayer) {
  let rect = null;
  let dots = [];
  let frameId = 0;
  let active = false;
  let pendingClientX = 0;
  let pendingClientY = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let dpr = 1;
  let maskRadius = BRAND_TITLE_MASK_DEFAULT_RADIUS;

  const measure = () => {
    rect = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    maskRadius = Number.parseFloat(styles.getPropertyValue("--brand-title-mask-radius")) ||
      BRAND_TITLE_MASK_DEFAULT_RADIUS;
    dpr = Math.min(
      BRAND_TITLE_CANVAS_DPR_LIMIT,
      Math.max(1, window.devicePixelRatio || 1),
    );
    canvasWidth = Math.max(1, Math.ceil(rect.width));
    canvasHeight = Math.max(1, Math.ceil(rect.height));

    const pixelWidth = Math.ceil(canvasWidth * dpr);
    const pixelHeight = Math.ceil(canvasHeight * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    dots = [...baseLayer.querySelectorAll(".brand-title__dot.is-on")].map((dot, index) => {
      const dotRect = dot.getBoundingClientRect();
      return {
        hue: Math.round((210 + index * 3.1) % 360),
        radius: Math.max(1, Math.max(dotRect.width, dotRect.height) / 2),
        x: dotRect.left - rect.left + dotRect.width / 2,
        y: dotRect.top - rect.top + dotRect.height / 2,
      };
    });
  };

  const clearCanvas = () => {
    context.clearRect(0, 0, canvasWidth, canvasHeight);
  };

  const drawMask = () => {
    frameId = 0;
    if (!active || !node.isConnected || !canvas.isConnected) {
      return;
    }
    if (!rect) {
      measure();
    }

    const x = clamp(pendingClientX - rect.left, 0, rect.width);
    const y = clamp(pendingClientY - rect.top, 0, rect.height);
    clearCanvas();

    for (const dot of dots) {
      const distance = Math.hypot(dot.x - x, dot.y - y);
      const alpha = getBrandTitleMaskAlpha(distance, maskRadius);
      if (alpha <= 0.01) {
        continue;
      }

      context.fillStyle = `hsla(${dot.hue}, 38%, 72%, ${alpha.toFixed(3)})`;
      context.beginPath();
      context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
      context.fill();
    }

    node.classList.add("is-color-mask-active");
  };

  const scheduleMaskDraw = (event) => {
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    if (!active) {
      active = true;
      measure();
    }
    node.classList.add("is-color-mask-active");
    if (!frameId) {
      frameId = requestAnimationFrame(drawMask);
    }
  };

  const handlePointerLeave = () => {
    active = false;
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    clearCanvas();
    rect = null;
    dots = [];
    node.classList.remove("is-color-mask-active");
  };

  node.addEventListener("pointerenter", scheduleMaskDraw, POINTER_MASK_EVENT_OPTIONS);
  node.addEventListener("pointermove", scheduleMaskDraw, POINTER_MASK_EVENT_OPTIONS);
  node.addEventListener("pointerleave", handlePointerLeave, POINTER_MASK_EVENT_OPTIONS);
}

function getBrandTitleMaskAlpha(distance, radius) {
  if (distance >= radius) {
    return 0;
  }

  const solidEdge = radius * 0.48;
  if (distance <= solidEdge) {
    return 1;
  }

  const softEdge = radius * 0.72;
  if (distance <= softEdge) {
    const progress = (distance - solidEdge) / (softEdge - solidEdge);
    return 1 - progress * 0.66;
  }

  const progress = (distance - softEdge) / (radius - softEdge);
  return 0.34 * (1 - progress);
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
