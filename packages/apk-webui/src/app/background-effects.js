import { clamp } from "./math.js";

const DOT_FIELD_TWO_PI = Math.PI * 2;
const DOT_FIELD_DPR_LIMIT = 2;
const DOT_FIELD_REST_COORDINATE = -9999;
const DOT_FIELD_RESIZE_DELAY_MS = 100;
const DOT_FIELD_SPEED_SAMPLE_MS = 20;
const DOT_FIELD_CONFIG = Object.freeze({
  dotRadius: 1.5,
  dotSpacing: 14,
  cursorRadius: 500,
  bulgeStrength: 67,
  glowRadius: 160,
});
const DOT_FIELD_PALETTES = Object.freeze({
  light: Object.freeze({
    dotFrom: "rgba(168, 85, 247, 0.82)",
    dotTo: "rgba(180, 151, 207, 0.72)",
    glowRgb: Object.freeze([255, 255, 255]),
    glowAlpha: 0.78,
  }),
  dark: Object.freeze({
    dotFrom: "#A855F7",
    dotTo: "#B497CF",
    glowRgb: Object.freeze([18, 15, 23]),
    glowAlpha: 0.92,
  }),
});

export function shouldAnimateDotField({
  powerConstrained,
  visibilityState,
  fineHover,
  canvasVisible = true,
}) {
  return !powerConstrained && visibilityState !== "hidden" && fineHover && canvasVisible;
}

export function initColorOrbBackground({ canvas, fineHoverMedia, isPowerConstrained }) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  canvas.dataset.renderer = "dot-field";
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    canvas.dataset.renderer = "dot-field-unavailable";
    return;
  }

  const pointer = {
    x: DOT_FIELD_REST_COORDINATE,
    y: DOT_FIELD_REST_COORDINATE,
    prevX: DOT_FIELD_REST_COORDINATE,
    prevY: DOT_FIELD_REST_COORDINATE,
    speed: 0,
    active: false,
  };
  const metrics = {
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    dpr: 1,
  };
  let dots = [];
  let resizeTimer = 0;
  let speedTimer = 0;
  let animationFrame = 0;
  let engagement = 0;
  let glowOpacity = 0;
  let palette = resolveDotFieldPalette();
  let canvasVisible = true;
  const canAnimate = () => shouldAnimateDotField({
    powerConstrained: isPowerConstrained(),
    visibilityState: document.visibilityState,
    fineHover: fineHoverMedia.matches,
    canvasVisible,
  });

  const visibilityObserver = typeof IntersectionObserver === "function"
    ? new IntersectionObserver(([entry]) => {
      canvasVisible = entry?.isIntersecting !== false;
      refreshMotionMode();
    })
    : null;
  visibilityObserver?.observe(canvas);

  function resizeNow() {
    window.clearTimeout(resizeTimer);
    resizeTimer = 0;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || window.innerWidth || 1));
    const height = Math.max(1, Math.round(rect.height || window.innerHeight || 1));
    const dpr = Math.min(window.devicePixelRatio || 1, DOT_FIELD_DPR_LIMIT);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    const sizeChanged = (
      metrics.width !== width ||
      metrics.height !== height ||
      metrics.dpr !== dpr ||
      canvas.width !== pixelWidth ||
      canvas.height !== pixelHeight
    );

    metrics.left = rect.left;
    metrics.top = rect.top;
    if (!sizeChanged) {
      drawFrame();
      return;
    }

    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }

    metrics.width = width;
    metrics.height = height;
    metrics.dpr = dpr;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildDots();
    drawFrame();
  }

  function scheduleResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resizeNow, DOT_FIELD_RESIZE_DELAY_MS);
  }

  function buildDots() {
    const step = DOT_FIELD_CONFIG.dotRadius + DOT_FIELD_CONFIG.dotSpacing;
    const cols = Math.max(1, Math.floor(metrics.width / step));
    const rows = Math.max(1, Math.floor(metrics.height / step));
    const padX = (metrics.width % step) / 2;
    const padY = (metrics.height % step) / 2;
    const nextDots = new Array(cols * rows);
    let index = 0;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = padX + col * step + step / 2;
        const y = padY + row * step + step / 2;
        nextDots[index] = {
          ax: x,
          ay: y,
          sx: x,
          sy: y,
        };
        index += 1;
      }
    }

    dots = nextDots;
  }

  function updatePointer(event) {
    const x = event.clientX - metrics.left;
    const y = event.clientY - metrics.top;

    if (!pointer.active) {
      pointer.prevX = x;
      pointer.prevY = y;
      pointer.active = true;
    }

    pointer.x = x;
    pointer.y = y;
  }

  function clearPointer() {
    pointer.x = DOT_FIELD_REST_COORDINATE;
    pointer.y = DOT_FIELD_REST_COORDINATE;
    pointer.prevX = DOT_FIELD_REST_COORDINATE;
    pointer.prevY = DOT_FIELD_REST_COORDINATE;
    pointer.speed = 0;
    pointer.active = false;
  }

  function updatePointerSpeed() {
    if (!pointer.active) {
      pointer.speed += (0 - pointer.speed) * 0.5;
      return;
    }

    const dx = pointer.prevX - pointer.x;
    const dy = pointer.prevY - pointer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    pointer.speed += (distance - pointer.speed) * 0.5;
    if (pointer.speed < 0.001) {
      pointer.speed = 0;
    }
    pointer.prevX = pointer.x;
    pointer.prevY = pointer.y;
  }

  function drawFrame() {
    const { width, height } = metrics;
    if (!width || !height) {
      return;
    }

    const animated = canAnimate();
    const targetEngagement = animated ? Math.min(pointer.speed / 5, 1) : 0;
    engagement += (targetEngagement - engagement) * 0.06;
    if (engagement < 0.001) {
      engagement = 0;
    }
    glowOpacity += (engagement - glowOpacity) * 0.08;
    if (glowOpacity < 0.001) {
      glowOpacity = 0;
    }

    context.clearRect(0, 0, width, height);

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette.dotFrom);
    gradient.addColorStop(1, palette.dotTo);
    context.fillStyle = gradient;

    const radius = DOT_FIELD_CONFIG.dotRadius / 2;
    const cursorRadius = DOT_FIELD_CONFIG.cursorRadius;
    const cursorRadiusSquared = cursorRadius * cursorRadius;

    context.beginPath();
    for (const dot of dots) {
      if (animated) {
        moveDotForPointer(dot, cursorRadius, cursorRadiusSquared);
      } else {
        dot.sx = dot.ax;
        dot.sy = dot.ay;
      }

      context.moveTo(dot.sx + radius, dot.sy);
      context.arc(dot.sx, dot.sy, radius, 0, DOT_FIELD_TWO_PI);
    }
    context.fill();
    drawPointerGlow(width, height);
  }

  function moveDotForPointer(dot, cursorRadius, cursorRadiusSquared) {
    const dx = pointer.x - dot.ax;
    const dy = pointer.y - dot.ay;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < cursorRadiusSquared && engagement > 0.01) {
      const distance = Math.sqrt(distanceSquared);
      const strength = 1 - distance / cursorRadius;
      const push = strength * strength * DOT_FIELD_CONFIG.bulgeStrength * engagement;
      const angle = Math.atan2(dy, dx);
      dot.sx += (dot.ax - Math.cos(angle) * push - dot.sx) * 0.15;
      dot.sy += (dot.ay - Math.sin(angle) * push - dot.sy) * 0.15;
      return;
    }

    dot.sx += (dot.ax - dot.sx) * 0.1;
    dot.sy += (dot.ay - dot.sy) * 0.1;
  }

  function drawPointerGlow(width, height) {
    if (!glowOpacity || pointer.x < -1000 || pointer.y < -1000) {
      return;
    }

    const radius = DOT_FIELD_CONFIG.glowRadius;
    const x = clamp(pointer.x, -radius, width + radius);
    const y = clamp(pointer.y, -radius, height + radius);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = palette.glowAlpha * glowOpacity;
    gradient.addColorStop(0, formatDotFieldRgba(palette.glowRgb, alpha));
    gradient.addColorStop(0.64, formatDotFieldRgba(palette.glowRgb, alpha * 0.28));
    gradient.addColorStop(1, formatDotFieldRgba(palette.glowRgb, 0));
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function tick() {
    animationFrame = 0;
    drawFrame();
    startAnimation();
  }

  function startAnimation() {
    if (!canAnimate()) {
      stopAnimation();
      drawFrame();
      return;
    }

    if (!speedTimer) {
      speedTimer = window.setInterval(updatePointerSpeed, DOT_FIELD_SPEED_SAMPLE_MS);
    }
    if (!animationFrame) {
      animationFrame = window.requestAnimationFrame(tick);
    }
  }

  function stopAnimation() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    if (speedTimer) {
      window.clearInterval(speedTimer);
      speedTimer = 0;
    }
  }

  function refreshPalette() {
    palette = resolveDotFieldPalette();
    drawFrame();
  }

  function refreshMotionMode() {
    if (!canAnimate()) {
      clearPointer();
      engagement = 0;
      glowOpacity = 0;
    }
    startAnimation();
  }

  resizeNow();
  window.addEventListener("resize", scheduleResize, { passive: true });
  window.addEventListener("pointermove", updatePointer, { passive: true });
  window.addEventListener("blur", clearPointer);
  window.addEventListener("apk-theme-change", refreshPalette);
  window.addEventListener("apk-power-mode-change", refreshMotionMode);
  addMediaChangeListener(fineHoverMedia, refreshMotionMode);
  document.addEventListener("visibilitychange", refreshMotionMode);
  startAnimation();
}

function resolveDotFieldPalette() {
  return document.documentElement.dataset.colorScheme === "dark"
    ? DOT_FIELD_PALETTES.dark
    : DOT_FIELD_PALETTES.light;
}

function formatDotFieldRgba(rgb, alpha) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function addMediaChangeListener(mediaQuery, listener) {
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
  } else {
    mediaQuery.addListener(listener);
  }
}
