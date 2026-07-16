import "../pwa-install-guide.css";

import { escapeAttr, escapeHtml } from "./html.js";

const DISMISS_STORAGE_KEY = "apk-webui-pwa-guide-dismissed-until";
const INSTALLED_STORAGE_KEY = "apk-webui-pwa-installed-until";
const DISMISS_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const INSTALLED_MARKER_DURATION_MS = 180 * 24 * 60 * 60 * 1000;
const AUTO_REPLAY_DELAY_MS = 2400;
const GUIDE_INSTALL_BUTTON_RIGHT = 466;
const GUIDE_INSTALL_BUTTON_PADDING = 11;
const GUIDE_INSTALL_BUTTON_ICON_WIDTH = 18;
const GUIDE_INSTALL_BUTTON_GAP = 8;
const INSTALL_DESKTOP_ICON_PATH = "M480-160q-17 0-28.5-11.5T440-200v-40H160q-33 0-56.5-23.5T80-320v-480q0-33 23.5-56.5T160-880h280v80H160v480h640v-120h80v120q0 33-23.5 56.5T800-240H520v40q0 17-11.5 28.5T480-160ZM760-480 560-680l56-56 104 104v-248h80v248l104-104 56 56-200 200Z";
const LIBCHECKER_ICON_PATH = "M139.391 222.718H129.667C125.942 222.566 123 219.502 123 215.773C123 212.045 125.942 208.98 129.667 208.828H139.391V194.942H129.667C125.942 194.79 123 191.726 123 187.997C123 184.268 125.942 181.204 129.667 181.052H139.391V167.166H129.667C125.942 167.014 123 163.95 123 160.221C123 156.492 125.942 153.428 129.667 153.276L139.391 153.277V150.499C139.39 147.552 140.559 144.726 142.643 142.643C144.726 140.56 147.552 139.39 150.498 139.391H153.277V129.668C153.429 125.942 156.493 123 160.222 123C163.951 123 167.015 125.942 167.167 129.668V139.39L181.053 139.391V129.668C181.205 125.942 184.269 123 187.998 123C191.726 123 194.791 125.942 194.943 129.668V139.391H208.829V129.668C208.981 125.942 212.045 123 215.774 123C219.502 123 222.567 125.942 222.719 129.668L222.717 139.39H225.496C228.443 139.388 231.269 140.558 233.354 142.641C235.438 144.724 236.609 147.55 236.609 150.497V153.276H246.333C250.058 153.428 253 156.492 253 160.221C253 163.95 250.058 167.014 246.333 167.166H236.609V181.052H246.333C250.058 181.204 253 184.268 253 187.997C253 191.726 250.058 194.79 246.333 194.942H236.609V208.827H246.333C250.058 208.979 253 212.043 253 215.772C253 219.501 250.058 222.565 246.333 222.717H236.609V225.496C236.609 231.633 231.633 236.609 225.496 236.609H222.717V246.332C222.565 250.058 219.501 253 215.772 253C212.044 253 208.979 250.058 208.827 246.332V236.609H194.941V246.332C194.789 250.058 191.725 253 187.996 253C184.268 253 181.203 250.058 181.051 246.332V236.609H167.166V246.332C167.014 250.058 163.949 253 160.22 253C156.492 253 153.427 250.058 153.275 246.332L153.277 236.61H150.498C144.361 236.61 139.391 231.635 139.391 225.497V222.718ZM202.723 167.162H173.277C169.886 167.162 167.167 169.887 167.167 173.272V202.718C167.163 204.34 167.805 205.896 168.952 207.043C170.099 208.19 171.655 208.832 173.277 208.828H202.723C206.113 208.828 208.833 206.103 208.833 202.718V173.272C208.833 169.881 206.108 167.162 202.723 167.162Z";

export function createPwaInstallGuide({
  root,
  t,
  onInstall,
  onEvent,
  isPowerConstrained,
  windowRef = window,
  navigatorRef = navigator,
  storage = window.localStorage,
  now = () => Date.now(),
}) {
  let installAvailable = false;
  let intersectionObserver = null;
  let autoReplayTimer = null;
  let presentedThisSession = false;
  const reducedMotionMedia = getReducedMotionMedia(windowRef);

  function show(options = {}) {
    installAvailable = Boolean(options.installAvailable);
    if (!isEligible()) {
      hide();
      return false;
    }

    if (presentedThisSession) {
      syncInstallAvailability();
      return !root.hidden;
    }

    render();
    root.hidden = false;
    syncSvgGeometryAfterRender();
    presentedThisSession = true;
    schedulePlayback();
    onEvent?.("viewed");
    return true;
  }

  function refresh() {
    if (root.hidden) {
      return;
    }
    render();
    syncSvgGeometryAfterRender();
    schedulePlayback();
  }

  function setInstallAvailable(value) {
    installAvailable = Boolean(value);
    syncInstallAvailability();
  }

  function markInstalled() {
    rememberPwaInstallation({ storage, timestamp: now() });
    hide();
  }

  function dismiss() {
    writeExpiry(storage, DISMISS_STORAGE_KEY, now() + DISMISS_DURATION_MS);
    onEvent?.("dismissed");
    hide();
  }

  function hide() {
    clearAutoReplay();
    intersectionObserver?.disconnect();
    intersectionObserver = null;
    root.classList.remove("is-playing", "is-complete");
    root.hidden = true;
  }

  function isEligible() {
    return (
      Boolean(getDesktopPlatform(navigatorRef)) &&
      supportsFileHandling(windowRef) &&
      !isRunningInstalled(windowRef, navigatorRef) &&
      !hasActiveExpiry(storage, DISMISS_STORAGE_KEY, now()) &&
      !hasActiveExpiry(storage, INSTALLED_STORAGE_KEY, now())
    );
  }

  function render() {
    root.className = "pwa-install-guide";
    root.setAttribute("aria-labelledby", "pwa-install-guide-title");
    root.innerHTML = buildGuideHtml(t, {
      installAvailable,
    });
    root.querySelector("[data-pwa-guide-dismiss]")?.addEventListener("click", dismiss);
    root.querySelector("[data-pwa-guide-install]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      root.classList.add("is-installing");
      try {
        await onInstall?.();
      } finally {
        root.classList.remove("is-installing");
        if (button.isConnected) {
          button.disabled = false;
        }
      }
    });
  }

  function syncInstallAvailability() {
    const button = root.querySelector("[data-pwa-guide-install]");
    const actions = root.querySelector(".pwa-install-guide__actions");
    if (button) {
      button.hidden = !installAvailable;
    }
    if (actions) {
      actions.hidden = !installAvailable;
    }
    root.classList.toggle("has-install-prompt", installAvailable);
  }

  function syncSvgGeometry() {
    fitInstallSceneButton();
    syncCheckmarkPathLength();
  }

  function syncSvgGeometryAfterRender() {
    syncSvgGeometry();
    windowRef.requestAnimationFrame?.(syncSvgGeometry);
  }

  function fitInstallSceneButton() {
    const background = root.querySelector(
      ".pwa-guide-install-control .pwa-guide-accent-fill",
    );
    const icon = root.querySelector(".pwa-guide-button-icon");
    const label = root.querySelector(".pwa-guide-button-label");
    const textWidth = label?.getComputedTextLength?.();
    if (!background || !icon || !label || !Number.isFinite(textWidth) || textWidth <= 0) {
      return;
    }

    const width = getGuideInstallButtonWidth(textWidth);
    const x = GUIDE_INSTALL_BUTTON_RIGHT - width;
    background.setAttribute("x", String(x));
    background.setAttribute("width", String(width));
    icon.setAttribute("x", String(x + GUIDE_INSTALL_BUTTON_PADDING));
    label.setAttribute("x", String(
      x + GUIDE_INSTALL_BUTTON_PADDING + GUIDE_INSTALL_BUTTON_ICON_WIDTH + GUIDE_INSTALL_BUTTON_GAP,
    ));
  }

  function syncCheckmarkPathLength() {
    const checkmark = root.querySelector(".pwa-guide-check-path");
    const length = checkmark?.getTotalLength?.();
    if (!checkmark || !Number.isFinite(length) || length <= 0) {
      return;
    }
    checkmark.style.setProperty("--pwa-guide-check-length", String(length));
  }

  function schedulePlayback() {
    clearAutoReplay();
    intersectionObserver?.disconnect();
    intersectionObserver = null;
    root.classList.remove("is-playing", "is-complete");

    if (root.hidden) {
      return;
    }
    if (hasMotionConstraint() || isDocumentHidden()) {
      completePlayback();
      return;
    }

    if (typeof windowRef.IntersectionObserver !== "function") {
      windowRef.requestAnimationFrame(startPlayback);
      return;
    }

    intersectionObserver = new windowRef.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35)) {
        return;
      }
      intersectionObserver?.disconnect();
      intersectionObserver = null;
      startPlayback();
    }, { threshold: [0.35] });
    intersectionObserver.observe(root);
  }

  function startPlayback() {
    clearAutoReplay();
    if (root.hidden || hasMotionConstraint() || isDocumentHidden()) {
      completePlayback();
      return;
    }
    root.classList.remove("is-playing", "is-complete");
    void root.offsetWidth;
    root.classList.add("is-playing");
  }

  function completePlayback({ autoReplay = false } = {}) {
    clearAutoReplay();
    intersectionObserver?.disconnect();
    intersectionObserver = null;
    root.classList.remove("is-playing");
    root.classList.add("is-complete");
    if (autoReplay) {
      scheduleAutoReplay();
    }
  }

  function scheduleAutoReplay() {
    clearAutoReplay();
    if (root.hidden || hasMotionConstraint() || isDocumentHidden()) {
      return;
    }
    autoReplayTimer = windowRef.setTimeout(() => {
      autoReplayTimer = null;
      schedulePlayback();
    }, AUTO_REPLAY_DELAY_MS);
  }

  function clearAutoReplay() {
    if (autoReplayTimer !== null) {
      windowRef.clearTimeout(autoReplayTimer);
      autoReplayTimer = null;
    }
  }

  function hasMotionConstraint() {
    return Boolean(reducedMotionMedia?.matches) || Boolean(isPowerConstrained?.());
  }

  function handleMotionConstraintChange() {
    const constrained = hasMotionConstraint();
    if (root.hidden) {
      clearAutoReplay();
    } else if (constrained) {
      completePlayback();
    } else if (root.classList.contains("is-complete")) {
      scheduleAutoReplay();
    }
  }

  function handleVisibilityChange() {
    if (root.hidden) {
      clearAutoReplay();
    } else if (isDocumentHidden()) {
      completePlayback();
    } else if (root.classList.contains("is-complete") && !hasMotionConstraint()) {
      scheduleAutoReplay();
    }
  }

  function isDocumentHidden() {
    return root.ownerDocument?.visibilityState === "hidden";
  }

  root.addEventListener("animationend", (event) => {
    if (event.animationName !== "pwa-guide-scene-report") {
      return;
    }
    completePlayback({ autoReplay: true });
  });
  addMediaChangeListener(reducedMotionMedia, handleMotionConstraintChange);
  windowRef.addEventListener?.("apk-power-mode-change", handleMotionConstraintChange);
  root.ownerDocument?.addEventListener("visibilitychange", handleVisibilityChange);

  return {
    dismiss,
    hide,
    markInstalled,
    refresh,
    setInstallAvailable,
    show,
  };
}

export function rememberPwaInstallation({
  storage = window.localStorage,
  timestamp = Date.now(),
} = {}) {
  writeExpiry(storage, INSTALLED_STORAGE_KEY, timestamp + INSTALLED_MARKER_DURATION_MS);
}

export function getDesktopPlatform(navigatorRef = navigator) {
  if (navigatorRef.userAgentData?.mobile) {
    return "";
  }
  const platform = String(
    navigatorRef.userAgentData?.platform || navigatorRef.platform || navigatorRef.userAgent || "",
  ).toLowerCase();
  if (platform.includes("mac")) {
    return "mac";
  }
  if (platform.includes("win")) {
    return "windows";
  }
  return "";
}

export function supportsFileHandling(windowRef = window) {
  return typeof windowRef.launchQueue?.setConsumer === "function";
}

export function isRunningInstalled(windowRef = window, navigatorRef = navigator) {
  const displayModes = ["standalone", "minimal-ui", "window-controls-overlay"];
  return (
    displayModes.some((mode) => windowRef.matchMedia?.(`(display-mode: ${mode})`)?.matches) ||
    Boolean(navigatorRef.standalone)
  );
}

function getReducedMotionMedia(windowRef) {
  try {
    return windowRef.matchMedia?.("(prefers-reduced-motion: reduce)") || null;
  } catch {
    return null;
  }
}

function addMediaChangeListener(mediaQuery, listener) {
  if (typeof mediaQuery?.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
  } else if (typeof mediaQuery?.addListener === "function") {
    mediaQuery.addListener(listener);
  }
}

function hasActiveExpiry(storage, key, timestamp) {
  try {
    const value = Number(storage?.getItem(key));
    return Number.isFinite(value) && value > timestamp;
  } catch {
    return false;
  }
}

function writeExpiry(storage, key, timestamp) {
  try {
    storage?.setItem(key, String(timestamp));
  } catch {
    // The guide remains usable when storage is blocked or full.
  }
}

function buildGuideHtml(t, { installAvailable }) {
  const installHidden = installAvailable ? "" : " hidden";
  const actionsHidden = installAvailable ? "" : " hidden";
  const title = t("pwaGuideTitle");
  const installStep = t("pwaGuideStepInstall");
  const openStep = t("pwaGuideStepOpen");
  const analyzeStep = t("pwaGuideStepAnalyze");
  const openWith = t("pwaGuideMenuOpenWith");
  const reportDone = t("pwaGuideSceneDone");

  return [
    `<button class="pwa-install-guide__dismiss" type="button" data-pwa-guide-dismiss aria-label="${escapeAttr(t("pwaGuideDismiss"))}" title="${escapeAttr(t("pwaGuideDismiss"))}">`,
    `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.25 5.25 9.5 9.5m0-9.5-9.5 9.5"></path></svg>`,
    `</button>`,
    `<div class="pwa-install-guide__copy">`,
    `<span class="pwa-install-guide__eyebrow">${escapeHtml(t("pwaGuideEyebrow"))}</span>`,
    `<h2 id="pwa-install-guide-title">${escapeHtml(title)}</h2>`,
    `<p class="pwa-install-guide__body">${escapeHtml(t("pwaGuideBody"))}</p>`,
    `<ol class="sr-only">`,
    `<li>${escapeHtml(installStep)}</li>`,
    `<li>${escapeHtml(openStep)}</li>`,
    `<li>${escapeHtml(analyzeStep)}</li>`,
    `</ol>`,
    `<div class="pwa-install-guide__actions"${actionsHidden}>`,
    `<button class="pwa-install-guide__install" type="button" data-pwa-guide-install${installHidden}>`,
    `<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="${INSTALL_DESKTOP_ICON_PATH}"></path></svg>`,
    `<span>${escapeHtml(t("pwaGuideInstall"))}</span>`,
    `</button>`,
    `</div>`,
    `<p class="pwa-install-guide__manual">${escapeHtml(t("pwaGuideManual"))}</p>`,
    `<p class="pwa-install-guide__permission-note">${escapeHtml(t("pwaGuideFirstOpenNote"))}</p>`,
    `</div>`,
    `<div class="pwa-install-guide__visual">`,
    `<svg class="pwa-install-guide__stage" viewBox="0 0 560 300" aria-hidden="true" focusable="false">`,
    `<defs>`,
    `<symbol id="pwa-guide-install-desktop" viewBox="0 -960 960 960"><path d="${INSTALL_DESKTOP_ICON_PATH}"></path></symbol>`,
    `<symbol id="pwa-guide-libchecker-mark" viewBox="123 123 130 130"><path d="${LIBCHECKER_ICON_PATH}"></path></symbol>`,
    `</defs>`,
    `<rect class="pwa-guide-stage-bg" x="1" y="1" width="558" height="298" rx="28"></rect>`,
    `<circle class="pwa-guide-orb pwa-guide-orb--one" cx="76" cy="52" r="68"></circle>`,
    `<circle class="pwa-guide-orb pwa-guide-orb--two" cx="486" cy="238" r="70"></circle>`,
    renderInstallScene(installStep, t("pwaGuideInstall")),
    renderOpenWithScene(openStep, openWith),
    renderReportScene(analyzeStep, reportDone),
    renderSharedApk(),
    `</svg>`,
    `<div class="pwa-install-guide__progress" aria-hidden="true">`,
    `<span class="pwa-install-guide__progress-item pwa-install-guide__progress-item--one"></span>`,
    `<span class="pwa-install-guide__progress-item pwa-install-guide__progress-item--two"></span>`,
    `<span class="pwa-install-guide__progress-item pwa-install-guide__progress-item--three"></span>`,
    `</div>`,
    `</div>`,
  ].join("");
}

function renderInstallScene(sceneLabel, buttonLabel) {
  const button = getGuideInstallButtonGeometry(buttonLabel);
  return [
    `<g class="pwa-guide-scene pwa-guide-scene--install">`,
    renderBrowserFrame(),
    renderBrandMark(116, 126, 23),
    `<rect class="pwa-guide-placeholder" x="153" y="109" width="142" height="14" rx="7"></rect>`,
    `<rect class="pwa-guide-placeholder pwa-guide-placeholder--short" x="153" y="136" width="102" height="10" rx="5"></rect>`,
    `<g class="pwa-guide-install-control">`,
    `<rect class="pwa-guide-accent-fill" x="${button.x}" y="105" width="${button.width}" height="32" rx="16"></rect>`,
    `<use class="pwa-guide-button-icon" href="#pwa-guide-install-desktop" x="${button.iconX}" y="112" width="18" height="18"></use>`,
    `<text class="pwa-guide-button-label" x="${button.labelX}" y="125">${escapeHtml(buttonLabel)}</text>`,
    `</g>`,
    `<rect class="pwa-guide-placeholder pwa-guide-placeholder--soft" x="92" y="168" width="376" height="60" rx="14"></rect>`,
    `<text class="pwa-guide-scene-label" x="280" y="280" text-anchor="middle">${escapeHtml(sceneLabel)}</text>`,
    `</g>`,
  ].join("");
}

function getGuideInstallButtonGeometry(label) {
  const width = getGuideInstallButtonWidth(estimateGuideTextWidth(label));
  const x = GUIDE_INSTALL_BUTTON_RIGHT - width;
  return {
    iconX: x + GUIDE_INSTALL_BUTTON_PADDING,
    labelX: x + GUIDE_INSTALL_BUTTON_PADDING + GUIDE_INSTALL_BUTTON_ICON_WIDTH + GUIDE_INSTALL_BUTTON_GAP,
    width,
    x,
  };
}

function getGuideInstallButtonWidth(textWidth) {
  return (
    GUIDE_INSTALL_BUTTON_PADDING * 2 +
    GUIDE_INSTALL_BUTTON_ICON_WIDTH +
    GUIDE_INSTALL_BUTTON_GAP +
    textWidth
  );
}

function estimateGuideTextWidth(value) {
  const width = Array.from(String(value)).reduce((total, character) => {
    if (/\s/u.test(character)) {
      return total + 3.5;
    }
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) {
      return total + 10;
    }
    return total + (/[A-Z]/u.test(character) ? 6.4 : 5.4);
  }, 0);
  return Math.round(width * 10) / 10;
}

function renderOpenWithScene(label, openWith) {
  return [
    `<g class="pwa-guide-scene pwa-guide-scene--open">`,
    renderBrowserFrame(),
    `<rect class="pwa-guide-sidebar" x="82" y="99" width="126" height="132" rx="12"></rect>`,
    `<rect class="pwa-guide-placeholder" x="97" y="115" width="76" height="10" rx="5"></rect>`,
    `<rect class="pwa-guide-placeholder pwa-guide-placeholder--short" x="97" y="137" width="56" height="10" rx="5"></rect>`,
    `<g class="pwa-guide-context-menu">`,
    `<rect class="pwa-guide-menu" x="232" y="99" width="244" height="132" rx="14"></rect>`,
    `<rect class="pwa-guide-placeholder" x="250" y="116" width="92" height="10" rx="5"></rect>`,
    `<rect class="pwa-guide-menu-highlight" x="244" y="140" width="220" height="34" rx="17"></rect>`,
    renderBrandMark(263, 157, 9),
    `<text class="pwa-guide-menu-label" x="280" y="161">${escapeHtml(openWith)}</text>`,
    `<rect class="pwa-guide-placeholder pwa-guide-placeholder--short" x="250" y="194" width="116" height="10" rx="5"></rect>`,
    `</g>`,
    `<text class="pwa-guide-scene-label" x="280" y="280" text-anchor="middle">${escapeHtml(label)}</text>`,
    `<path class="pwa-guide-cursor" d="m447 174 16 7-7 3 5 8-5 3-5-9-6 5z"></path>`,
    `</g>`,
  ].join("");
}

function renderReportScene(label, done) {
  return [
    `<g class="pwa-guide-scene pwa-guide-scene--report">`,
    renderBrowserFrame(),
    renderBrandMark(116, 125, 24),
    `<rect class="pwa-guide-placeholder" x="153" y="108" width="150" height="14" rx="7"></rect>`,
    `<rect class="pwa-guide-placeholder pwa-guide-placeholder--short" x="153" y="135" width="104" height="10" rx="5"></rect>`,
    `<g class="pwa-guide-result-row pwa-guide-result-row--one">`,
    `<circle class="pwa-guide-result-dot" cx="107" cy="184" r="7"></circle>`,
    `<rect class="pwa-guide-placeholder" x="128" y="178" width="252" height="12" rx="6"></rect>`,
    `</g>`,
    `<g class="pwa-guide-result-row pwa-guide-result-row--two">`,
    `<circle class="pwa-guide-result-dot" cx="107" cy="216" r="7"></circle>`,
    `<rect class="pwa-guide-placeholder pwa-guide-placeholder--short" x="128" y="210" width="192" height="12" rx="6"></rect>`,
    `</g>`,
    `<g class="pwa-guide-check">`,
    `<circle class="pwa-guide-check-bg" cx="444" cy="125" r="24"></circle>`,
    `<path class="pwa-guide-check-path" d="m433 125 8 8 16-18"></path>`,
    `</g>`,
    `<path class="pwa-guide-scan-line" d="M92 162h376"></path>`,
    `<text class="pwa-guide-scene-label" x="280" y="280" text-anchor="middle">${escapeHtml(`${label} · ${done}`)}</text>`,
    `</g>`,
  ].join("");
}

function renderBrowserFrame() {
  return [
    `<rect class="pwa-guide-window" x="64" y="43" width="432" height="214" rx="18"></rect>`,
    `<path class="pwa-guide-window-line" d="M64 82h432"></path>`,
    `<circle class="pwa-guide-window-dot" cx="88" cy="63" r="4"></circle>`,
    `<circle class="pwa-guide-window-dot" cx="102" cy="63" r="4"></circle>`,
    `<circle class="pwa-guide-window-dot" cx="116" cy="63" r="4"></circle>`,
  ].join("");
}

function renderBrandMark(cx, cy, radius) {
  const iconSize = radius * 1.18;
  const iconX = cx - iconSize / 2;
  const iconY = cy - iconSize / 2;
  return [
    `<circle class="pwa-guide-app-icon-bg" cx="${cx}" cy="${cy}" r="${radius}"></circle>`,
    `<use class="pwa-guide-app-icon" href="#pwa-guide-libchecker-mark" x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}"></use>`,
  ].join("");
}

function renderSharedApk() {
  return [
    `<g class="pwa-guide-shared-apk">`,
    `<path class="pwa-guide-apk-file" d="M279 155h36l14 14v52h-50z"></path>`,
    `<path class="pwa-guide-apk-fold" d="M315 155v14h14"></path>`,
    `<rect class="pwa-guide-apk-badge" x="287" y="183" width="34" height="18" rx="7"></rect>`,
    `<text class="pwa-guide-apk-label" x="304" y="196" text-anchor="middle">APK</text>`,
    `</g>`,
  ].join("");
}
