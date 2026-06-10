import { clamp } from "./math.js";

const BRAND_TITLE_MASK_DEFAULT_RADIUS = 84;
const BRAND_TITLE_CANVAS_DPR_LIMIT = 2;
const BRAND_TITLE_MASK_REVEAL_MS = 320;
const BRAND_TITLE_MASK_REVEAL_FEATHER_SCALE = 0.34;
const POINTER_MASK_EVENT_OPTIONS = { passive: true };

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
  let revealStartedAt = 0;

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

    dots = [];
    let index = 0;
    for (const dot of baseLayer.querySelectorAll(".brand-title__dot.is-on")) {
      const dotRect = dot.getBoundingClientRect();
      dots.push({
        hue: Math.round((210 + index * 3.1) % 360),
        radius: Math.max(1, Math.max(dotRect.width, dotRect.height) / 2),
        x: dotRect.left - rect.left + dotRect.width / 2,
        y: dotRect.top - rect.top + dotRect.height / 2,
      });
      index += 1;
    }
  };

  const clearCanvas = () => {
    context.clearRect(0, 0, canvasWidth, canvasHeight);
  };

  const drawMask = (timestamp = performance.now()) => {
    if (!active || !node.isConnected || !canvas.isConnected) {
      frameId = 0;
      return;
    }
    if (!rect) {
      measure();
    }

    const revealProgress = getBrandTitleMaskRevealProgress(timestamp - revealStartedAt);
    const easedRevealProgress = easeInOutCubic(revealProgress);
    const revealFeather = maskRadius * BRAND_TITLE_MASK_REVEAL_FEATHER_SCALE;
    const revealRadius = (maskRadius + revealFeather) * easedRevealProgress;
    const x = clamp(pendingClientX - rect.left, 0, rect.width);
    const y = clamp(pendingClientY - rect.top, 0, rect.height);
    clearCanvas();

    for (const dot of dots) {
      const distance = Math.hypot(dot.x - x, dot.y - y);
      const alpha = getBrandTitleMaskAlpha(distance, maskRadius) *
        getBrandTitleRevealAlpha(distance, revealRadius, revealFeather);
      if (alpha <= 0.01) {
        continue;
      }

      context.fillStyle = `hsla(${dot.hue}, 38%, 72%, ${alpha.toFixed(3)})`;
      context.beginPath();
      context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
      context.fill();
    }

    node.classList.add("is-color-mask-active");
    if (revealProgress < 1) {
      frameId = requestAnimationFrame(drawMask);
      return;
    }

    frameId = 0;
  };

  const scheduleMaskDraw = (event) => {
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    if (!active) {
      active = true;
      revealStartedAt = performance.now();
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

function getBrandTitleMaskRevealProgress(elapsedMs) {
  return clamp(elapsedMs / BRAND_TITLE_MASK_REVEAL_MS, 0, 1);
}

function getBrandTitleRevealAlpha(distance, revealRadius, revealFeather) {
  if (revealRadius <= 0 || distance >= revealRadius) {
    return 0;
  }

  const solidEdge = Math.max(0, revealRadius - revealFeather);
  if (distance <= solidEdge) {
    return 1;
  }

  const progress = (distance - solidEdge) / (revealRadius - solidEdge);
  return 1 - easeInOutCubic(progress);
}

function easeInOutCubic(progress) {
  if (progress < 0.5) {
    return 4 * progress ** 3;
  }

  return 1 - ((-2 * progress + 2) ** 3) / 2;
}
