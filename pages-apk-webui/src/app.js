import { escapeAttr, escapeHtml } from "./app/html.js";
import { getSupportedLocales, normalizeLocale, resolvePreferredLocale, translate } from "./app/i18n.js";
import { clamp } from "./app/math.js";
import { formatBytes, formatResourceId, getInitial, sanitizeFilePart, sanitizeImageSrc, stripDataUris } from "./app/format.js";
import { COMPONENT_SECTIONS, countComponents, getStats, groupBy } from "./app/report-model.js";
import { buildHistorySummary, createHistoryEntry, persistHistory, persistHistoryCollapsed, readHistory, readHistoryCollapsed } from "./app/history.js";
import { getFileAnalyticsFields, getReportAnalyticsFields, initWebAnalytics, trackWebEvent } from "./app/analytics.js";
import { hydrateReportSdkIcons } from "./app/sdk-icon-cache.js";
import { getRegisteredSdkRuleDetail, renderSdkChip as renderSdkChipBase, renderSdkIcon, renderSdkInline as renderSdkInlineBase, renderSdkRuleLabel } from "./app/sdk-icon-renderer.js";
import { initBrandTitleColorMask, renderBrandTitle } from "./app/title-effects.js";
const VALID_TABS = new Set(["summary", "sdk", "native", "components", "permissions", "signatures", "metadata", "raw"]);
const VALID_APP_MODES = new Set(["analyze", "compare"]);
const THEME_STORAGE_KEY = "apk-webui-theme";
const THEME_CHOICES = new Set(["light", "dark", "system"]);
const WORKER_IDLE_TERMINATE_MS = 60_000;
const ARCHIVE_CHART_CENTER = 60;
const ARCHIVE_CHART_RADIUS = 52;
const ARCHIVE_CHART_LABEL_MIN_PERCENT = 6;
const ARCHIVE_CHART_SEGMENT_LIFT = 5;
const ARCHIVE_CHART_COLORS = [
  "#38bdf8",
  "#22c55e",
  "#f97316",
  "#eab308",
  "#a78bfa",
  "#f43f5e",
  "#14b8a6",
  "#64748b",
  "#d946ef",
  "#84cc16",
];
const CONTRIBUTOR_GITHUB_ALIASES = new Map([
  ["absinthe", "zhaobozhen"],
]);
const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const fineHoverMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
const tapPopupMedia = window.matchMedia("(hover: none), (pointer: coarse)");
const supportsPointerEvents = typeof window.PointerEvent === "function";


const state = {
  appMode: "analyze",
  locale: resolveInitialLocale(),
  themeChoice: readThemeChoice(),
  selectedFile: null,
  report: null,
  history: readHistory(),
  historyCollapsed: readHistoryCollapsed(),
  activeTab: "summary",
  activeNativeAbi: "",
  loadingHistoryId: "",
  worker: null,
  workerIdleTimer: null,
  jobs: new Map(),
  jobId: 0,
  activeAnalyzeJobId: null,
  startedAt: 0,
  timer: null,
};
const themeDrag = {
  active: false,
  pointerId: null,
  pendingChoice: "",
  suppressClick: false,
  buttonCenters: [],
};
const modeDrag = {
  active: false,
  pointerId: null,
  pendingMode: "",
  suppressClick: false,
  buttonCenters: [],
};
let historyOpenToken = 0;
let modeIndicatorFrame = 0;
let pendingModeIndicatorAppMode = "";
let themeIndicatorFrame = 0;
let pendingThemeIndicatorChoice = "";
const pointerCoordinateUpdaters = new WeakMap();
const dateTimeFormatters = new Map();
const exportJsonCache = new WeakMap();
let compareController = null;
let compareControllerPromise = null;
let terminalSystemDetectorPromise = null;
let appTitleColorMaskPromise = null;

const elements = {
  modeButtons: [...document.querySelectorAll("[data-app-mode]")],
  modeChipGroup: document.querySelector("#mode-chip-group"),
  themeButtons: [...document.querySelectorAll(".theme-chip[data-theme-choice]")],
  themeChipGroup: document.querySelector("#theme-chip-group"),
  languageSelect: document.querySelector("#language-select"),
  clearButton: document.querySelector("#clear-button"),
  backgroundCanvas: document.querySelector("#color-orb-background"),
  brandTitle: document.querySelector(".brand-title"),
  form: document.querySelector("#analyze-form"),
  fileInput: document.querySelector("#file-input"),
  fileMeta: document.querySelector("#file-meta"),
  dropZone: document.querySelector("#drop-zone"),
  analyzeButton: document.querySelector("#analyze-button"),
  analyzeButtonLabel: document.querySelector("#analyze-button span"),
  progress: document.querySelector("#progress"),
  progressLabel: document.querySelector("#progress-label"),
  progressTime: document.querySelector("#progress-time"),
  errorBox: document.querySelector("#error-box"),
  historyPanel: document.querySelector("#history-panel"),
  historyToggleButton: document.querySelector("#history-toggle-button"),
  historyContent: document.querySelector("#history-content"),
  historyList: document.querySelector("#history-list"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  emptyState: document.querySelector("#empty-state"),
  resultView: document.querySelector("#result-view"),
  reportHero: document.querySelector("#report-hero"),
  archiveDistribution: document.querySelector("#archive-distribution"),
  tabs: document.querySelector("#tabs"),
  tabButtons: [...document.querySelectorAll("#tabs [data-tab]")],
  tabPanel: document.querySelector("#tab-panel"),
  compareView: document.querySelector("#compare-view"),
  compareSlots: document.querySelector("#compare-slots"),
  compareWarning: document.querySelector("#compare-warning"),
  compareResult: document.querySelector("#compare-result"),
  compareFileInputs: [...document.querySelectorAll("[data-compare-file]")],
  compareDropZones: [...document.querySelectorAll("[data-compare-drop]")],
  compareHistorySelects: [...document.querySelectorAll("[data-compare-history]")],
  compareClearButtons: [...document.querySelectorAll("[data-compare-clear]")],
};

function t(key, variables = {}) {
  return translate(state.locale, key, variables);
}

function createCompareController(CompareController) {
  return new CompareController({
    elements: {
      view: elements.compareView,
      warning: elements.compareWarning,
      result: elements.compareResult,
      fileInputs: elements.compareFileInputs,
      dropZones: elements.compareDropZones,
      historySelects: elements.compareHistorySelects,
      clearButtons: elements.compareClearButtons,
    },
    t,
    getLocale: () => state.locale,
    getHistory: () => state.history,
    ensureWorker,
    createJob: (job) => {
      state.jobId += 1;
      state.jobs.set(state.jobId, job);
      return state.jobId;
    },
    deleteJob: (jobId) => {
      state.jobs.delete(jobId);
      scheduleWorkerIdleTermination();
    },
    hasJob: (jobId) => state.jobs.has(jobId),
    updateClearButton,
    trackEvent: trackWebEvent,
    getFileAnalyticsFields,
    getReportAnalyticsFields,
  });
}

function ensureCompareController() {
  if (compareController) {
    return Promise.resolve(compareController);
  }

  if (!compareControllerPromise) {
    compareControllerPromise = import("./app/compare-controller.js")
      .then(({ CompareController }) => {
        compareController = createCompareController(CompareController);
        compareController.bindEvents();
        compareController.setVisible(state.appMode === "compare");
        updateClearButton();
        return compareController;
      })
      .catch((error) => {
        compareControllerPromise = null;
        handleCompareControllerLoadError(error);
        return null;
      });
  }

  return compareControllerPromise;
}

function loadCompareControllerForCurrentMode() {
  void ensureCompareController().then((controller) => {
    if (!controller) {
      return;
    }

    controller.setVisible(state.appMode === "compare");
    updateClearButton();
  });
}

function handleCompareControllerLoadError(error) {
  console.error("Failed to load compare controller", error);
  trackWebEvent("webui.compare.load_failed", {
    result: "error",
    error_name: error?.name || "CompareControllerLoadError",
  });
  if (state.appMode !== "compare") {
    return;
  }

  elements.compareView.hidden = false;
  elements.compareWarning.hidden = false;
  elements.compareWarning.textContent = t("workerFailed");
  updateClearButton();
}

function renderComparePageIfLoaded() {
  if (compareController) {
    compareController.renderPage();
  } else if (state.appMode === "compare") {
    loadCompareControllerForCurrentMode();
  }
}

function renderCompareHistoryOptionsIfLoaded() {
  compareController?.renderHistoryOptions();
}

async function detectCurrentTerminalSystem() {
  if (!terminalSystemDetectorPromise) {
    terminalSystemDetectorPromise = import("./app/system.js")
      .then(({ detectTerminalSystem }) => detectTerminalSystem)
      .catch((error) => {
        terminalSystemDetectorPromise = null;
        throw error;
      });
  }

  const detectTerminalSystem = await terminalSystemDetectorPromise;
  return detectTerminalSystem();
}

function initReportTitleColorMask(root, info) {
  if (!root) {
    return;
  }

  void loadAppTitleColorMask().then((initAppTitleColorMask) => {
    if (root.isConnected) {
      initAppTitleColorMask(root, info);
    }
  }).catch(() => {
    // Report title color sampling is a visual enhancement; the default hue remains valid.
  });
}

function loadAppTitleColorMask() {
  if (!appTitleColorMaskPromise) {
    appTitleColorMaskPromise = import("./app/app-title-effects.js")
      .then(({ initAppTitleColorMask }) => initAppTitleColorMask)
      .catch((error) => {
        appTitleColorMaskPromise = null;
        throw error;
      });
  }

  return appTitleColorMaskPromise;
}

function resolveInitialLocale() {
  const browserLocales = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  return resolvePreferredLocale(browserLocales, "en");
}

applyThemeChoice(state.themeChoice, { persist: false });
renderLanguageOptions();
applyLocale();
renderBrandTitle(elements.brandTitle, t("title"));
initBrandTitleColorMask(elements.brandTitle);
renderHistoryList();
updateHistoryCollapse();
updateAppMode();
bindEvents();
initColorOrbBackground();
initSdkIconPreview();
initSdkRulePreview();
initArchiveChartPreview();
initWebAnalytics(() => ({
  locale: state.locale,
  ui_mode: state.appMode,
  theme_choice: state.themeChoice,
  color_scheme: document.documentElement.dataset.colorScheme || "",
  history_count: state.history.length,
  viewport_width: window.innerWidth || 0,
  viewport_height: window.innerHeight || 0,
}));

function bindEvents() {
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      if (modeDrag.suppressClick) {
        event.preventDefault();
        modeDrag.suppressClick = false;
        return;
      }

      setAppMode(button.dataset.appMode);
    });
  });
  elements.modeChipGroup.addEventListener("pointerdown", beginModeDrag);
  elements.modeChipGroup.addEventListener("pointermove", updateModeDrag);
  elements.modeChipGroup.addEventListener("pointerup", endModeDrag);
  elements.modeChipGroup.addEventListener("pointercancel", cancelModeDrag);
  elements.modeChipGroup.addEventListener("lostpointercapture", cancelModeDrag);

  elements.themeButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      if (themeDrag.suppressClick) {
        event.preventDefault();
        themeDrag.suppressClick = false;
        return;
      }

      applyThemeChoice(button.dataset.themeChoice);
    });
  });
  elements.themeChipGroup.addEventListener("pointerdown", beginThemeDrag);
  elements.themeChipGroup.addEventListener("pointermove", updateThemeDrag);
  elements.themeChipGroup.addEventListener("pointerup", endThemeDrag);
  elements.themeChipGroup.addEventListener("pointercancel", cancelThemeDrag);
  elements.themeChipGroup.addEventListener("lostpointercapture", cancelThemeDrag);

  systemThemeMedia.addEventListener("change", () => {
    if (state.themeChoice === "system") {
      applyThemeChoice("system", { persist: false });
    }
  });

  window.addEventListener("resize", () => {
    updateModeIndicator();
    updateThemeIndicator();
  });

  elements.languageSelect.addEventListener("change", () => {
    const previousLocale = state.locale;
    state.locale = normalizeLocale(elements.languageSelect.value);
    renderLanguageOptions();
    applyLocale();
    updateModeIndicator();
    updateThemeIndicator();
    updateHistoryCollapse();
    renderSelectedFile();
    renderHistoryList();
    renderReport();
    renderComparePageIfLoaded();
    if (previousLocale !== state.locale) {
      trackWebEvent("webui.locale.changed", {
        result: "success",
        operation: state.locale,
      });
    }
  });

  elements.fileInput.addEventListener("change", () => {
    setSelectedFile(elements.fileInput.files?.[0] || null);
  });

  elements.dropZone.addEventListener("pointerdown", activateDropZonePointer);
  elements.dropZone.addEventListener("pointerenter", activateDropZonePointer);
  elements.dropZone.addEventListener("pointermove", activateDropZonePointer);

  elements.dropZone.addEventListener("pointerleave", () => {
    elements.dropZone.classList.remove("is-pointer-active");
  });

  document.addEventListener("pointerup", clearTouchDropZonePointerState);
  document.addEventListener("pointercancel", clearTouchDropZonePointerState);
  window.addEventListener("blur", clearDropZonePointerState);

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    analyzeSelectedFile();
  });

  elements.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });

  elements.dropZone.addEventListener("dragleave", () => {
    elements.dropZone.classList.remove("is-dragging");
  });

  elements.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
    setSelectedFile(event.dataTransfer?.files?.[0] || null);
  });

  elements.clearButton.addEventListener("click", () => {
    if (state.appMode === "compare") {
      if (compareController) {
        compareController.reset();
      } else {
        loadCompareControllerForCurrentMode();
      }
    } else {
      resetState();
    }
  });

  elements.historyToggleButton.addEventListener("click", () => {
    setHistoryCollapsed(!state.historyCollapsed);
  });

  elements.clearHistoryButton.addEventListener("click", () => {
    clearHistory();
  });

  elements.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-history-action]");
    if (!button) {
      return;
    }

    if (state.loadingHistoryId) {
      event.preventDefault();
      return;
    }

    const id = button.dataset.historyId;
    if (button.dataset.historyAction === "open") {
      openHistoryItem(id);
    } else if (button.dataset.historyAction === "delete") {
      deleteHistoryItem(id);
    }
  });

  elements.historyList.addEventListener("pointerdown", handleHistoryPointerEvent);
  elements.historyList.addEventListener("pointerover", handleHistoryPointerEvent);
  elements.historyList.addEventListener("pointermove", handleHistoryPointerEvent);
  elements.historyList.addEventListener("pointerout", (event) => {
    const row = event.target.closest(".history-row");
    if (!row || row.contains(event.relatedTarget)) {
      return;
    }

    resetPointerCoordinates(row);
    row.classList.remove("is-pointer-active");
  });

  elements.historyList.addEventListener("pointerleave", clearHistoryPointerState);

  document.addEventListener("pointerup", clearTouchHistoryPointerState);
  document.addEventListener("pointercancel", clearTouchHistoryPointerState);
  window.addEventListener("blur", clearHistoryPointerState);

  document.addEventListener("pointerover", (event) => {
    const row = event.target.closest?.(".history-row");
    if (elements.historyList.contains(event.target) || (row && elements.historyList.contains(row))) {
      return;
    }

    clearHistoryPointerState();
  });

  elements.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]")?.dataset.tab;
    if (!tab || !VALID_TABS.has(tab)) {
      return;
    }

    if (tab === state.activeTab) {
      return;
    }

    state.activeTab = tab;
    updateTabs();
    renderTabPanel();
    trackWebEvent("webui.tab.changed", {
      result: "success",
      tab,
      operation: tab,
    });
  });

  elements.tabPanel.addEventListener("click", (event) => {
    const exportButton = event.target.closest("[data-json-export]");
    if (exportButton) {
      if (state.report) {
        downloadReport(state.report, elements.tabPanel.querySelector(".json-block")?.textContent || "");
      }
      return;
    }

    const button = event.target.closest("[data-native-abi]");
    if (!button || state.activeTab !== "native") {
      return;
    }

    state.activeNativeAbi = button.dataset.nativeAbi || "";
    renderTabPanel();
    trackWebEvent("webui.native_abi.changed", {
      result: "success",
      operation: state.activeNativeAbi,
    });
  });
}

function beginModeDrag(event) {
  if (event.button !== 0) {
    return;
  }

  modeDrag.active = true;
  modeDrag.pointerId = event.pointerId;
  modeDrag.suppressClick = true;
  modeDrag.buttonCenters = measureChoiceCenters(elements.modeButtons, "appMode");
  elements.modeChipGroup.classList.add("is-dragging");
  try {
    elements.modeChipGroup.setPointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture is an enhancement; nearest-mode dragging still works without it.
  }
  previewModeFromPointer(event);
}

function updateModeDrag(event) {
  if (!modeDrag.active || event.pointerId !== modeDrag.pointerId) {
    return;
  }

  previewModeFromPointer(event);
}

function endModeDrag(event) {
  if (!modeDrag.active || event.pointerId !== modeDrag.pointerId) {
    return;
  }

  previewModeFromPointer(event);
  if (modeDrag.pendingMode) {
    setAppMode(modeDrag.pendingMode);
  }
  finishModeDrag(event.pointerId);
}

function cancelModeDrag(event) {
  if (!modeDrag.active || event.pointerId !== modeDrag.pointerId) {
    return;
  }

  finishModeDrag(event.pointerId);
}

function finishModeDrag(pointerId) {
  elements.modeChipGroup.classList.remove("is-dragging");
  modeDrag.active = false;
  modeDrag.pointerId = null;
  modeDrag.pendingMode = "";
  modeDrag.buttonCenters = [];
  clearModePendingButtons();
  updateModeIndicator();
  try {
    if (elements.modeChipGroup.hasPointerCapture?.(pointerId)) {
      elements.modeChipGroup.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
  window.setTimeout(() => {
    modeDrag.suppressClick = false;
  }, 0);
}

function previewModeFromPointer(event) {
  const appMode = getAppModeAtClientX(event.clientX);
  if (!appMode || appMode === modeDrag.pendingMode) {
    return;
  }

  modeDrag.pendingMode = appMode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("is-pending", button.dataset.appMode === appMode);
  });
  updateModeIndicator(appMode);
}

function getAppModeAtClientX(clientX) {
  return getNearestChoiceAtClientX(clientX, modeDrag.buttonCenters, elements.modeButtons, "appMode");
}

function beginThemeDrag(event) {
  if (event.button !== 0) {
    return;
  }

  themeDrag.active = true;
  themeDrag.pointerId = event.pointerId;
  themeDrag.suppressClick = true;
  themeDrag.buttonCenters = measureChoiceCenters(elements.themeButtons, "themeChoice");
  elements.themeChipGroup.classList.add("is-dragging");
  try {
    elements.themeChipGroup.setPointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture is an enhancement; nearest-choice dragging still works without it.
  }
  previewThemeChoiceFromPointer(event);
}

function updateThemeDrag(event) {
  if (!themeDrag.active || event.pointerId !== themeDrag.pointerId) {
    return;
  }

  previewThemeChoiceFromPointer(event);
}

function endThemeDrag(event) {
  if (!themeDrag.active || event.pointerId !== themeDrag.pointerId) {
    return;
  }

  previewThemeChoiceFromPointer(event);
  if (themeDrag.pendingChoice) {
    applyThemeChoice(themeDrag.pendingChoice);
  }
  finishThemeDrag(event.pointerId);
}

function cancelThemeDrag(event) {
  if (!themeDrag.active || event.pointerId !== themeDrag.pointerId) {
    return;
  }

  finishThemeDrag(event.pointerId);
}

function finishThemeDrag(pointerId) {
  elements.themeChipGroup.classList.remove("is-dragging");
  themeDrag.active = false;
  themeDrag.pointerId = null;
  themeDrag.pendingChoice = "";
  themeDrag.buttonCenters = [];
  clearThemePendingButtons();
  updateThemeIndicator();
  try {
    if (elements.themeChipGroup.hasPointerCapture?.(pointerId)) {
      elements.themeChipGroup.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
  window.setTimeout(() => {
    themeDrag.suppressClick = false;
  }, 0);
}

function previewThemeChoiceFromPointer(event) {
  const themeChoice = getThemeChoiceAtClientX(event.clientX);
  if (!themeChoice || themeChoice === themeDrag.pendingChoice) {
    return;
  }

  themeDrag.pendingChoice = themeChoice;
  elements.themeButtons.forEach((button) => {
    button.classList.toggle("is-pending", button.dataset.themeChoice === themeChoice);
  });
  updateThemeIndicator(themeChoice);
}

function getThemeChoiceAtClientX(clientX) {
  return getNearestChoiceAtClientX(clientX, themeDrag.buttonCenters, elements.themeButtons, "themeChoice");
}

function measureChoiceCenters(buttons, datasetKey) {
  return buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return {
      value: button.dataset[datasetKey] || "",
      centerX: rect.left + rect.width / 2,
    };
  });
}

function getNearestChoiceAtClientX(clientX, measuredChoices, fallbackButtons, datasetKey) {
  const choices = measuredChoices.length
    ? measuredChoices
    : measureChoiceCenters(fallbackButtons, datasetKey);
  let nearestValue = "";
  let nearestDistance = Infinity;

  for (const choice of choices) {
    const distance = Math.abs(clientX - choice.centerX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestValue = choice.value;
    }
  }

  return nearestValue;
}

function updateDropZonePointer(event, zone = elements.dropZone) {
  schedulePointerCoordinates(event, zone, {
    xProperty: "--drop-x",
    yProperty: "--drop-y",
  });
}

function activateDropZonePointer(event) {
  updateDropZonePointer(event);
  if (shouldActivatePointerHighlight(event)) {
    elements.dropZone.classList.add("is-pointer-active");
  }
}

function clearDropZonePointerState() {
  resetPointerCoordinates(elements.dropZone);
  elements.dropZone.classList.remove("is-pointer-active");
}

function clearTouchDropZonePointerState(event) {
  if (!shouldClearPointerHighlightOnRelease(event)) {
    return;
  }

  clearDropZonePointerState();
}

function handleHistoryPointerEvent(event) {
  const row = event.target.closest(".history-row");
  if (!row || !elements.historyList.contains(row)) {
    clearActiveHistoryRows();
    return;
  }

  schedulePointerCoordinates(event, row, {
    xProperty: "--history-row-glass-x",
    yProperty: "--history-row-glass-y",
  });

  if (!shouldActivatePointerHighlight(event)) {
    return;
  }

  clearActiveHistoryRows(row);
  row.classList.add("is-pointer-active");
}

function clearActiveHistoryRows(exceptRow = null) {
  elements.historyList.querySelectorAll(".history-row.is-pointer-active").forEach((row) => {
    if (row !== exceptRow) {
      resetPointerCoordinates(row);
      row.classList.remove("is-pointer-active");
    }
  });
}

function clearHistoryPointerState() {
  clearActiveHistoryRows();
}

function clearTouchHistoryPointerState(event) {
  if (!shouldClearPointerHighlightOnRelease(event)) {
    return;
  }

  clearHistoryPointerState();
}

function schedulePointerCoordinates(event, node, options) {
  if (!node) {
    return;
  }

  let updater = pointerCoordinateUpdaters.get(node);
  if (!updater || updater.xProperty !== options.xProperty || updater.yProperty !== options.yProperty) {
    updater = createPointerCoordinateUpdater(node, options);
    pointerCoordinateUpdaters.set(node, updater);
  }

  updater.schedule(event.clientX, event.clientY, event.type);
}

function resetPointerCoordinates(node) {
  pointerCoordinateUpdaters.get(node)?.reset();
}

function createPointerCoordinateUpdater(node, { xProperty, yProperty }) {
  let frameId = 0;
  let rect = null;
  let pendingClientX = 0;
  let pendingClientY = 0;
  let lastX = "";
  let lastY = "";

  const readRect = () => {
    rect = node.getBoundingClientRect();
  };

  const shouldRefreshRect = (eventType) => (
    !rect ||
    eventType === "pointerdown" ||
    eventType === "pointerenter" ||
    eventType === "pointerover" ||
    eventType === "dragover"
  );

  const apply = () => {
    frameId = 0;
    if (!node.isConnected) {
      rect = null;
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
      node.style.setProperty(xProperty, nextX);
      lastX = nextX;
    }
    if (nextY !== lastY) {
      node.style.setProperty(yProperty, nextY);
      lastY = nextY;
    }
  };

  return {
    xProperty,
    yProperty,
    schedule(clientX, clientY, eventType) {
      pendingClientX = clientX;
      pendingClientY = clientY;
      if (shouldRefreshRect(eventType)) {
        readRect();
      }
      if (!frameId) {
        frameId = window.requestAnimationFrame(apply);
      }
    },
    reset() {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      rect = null;
      lastX = "";
      lastY = "";
    },
  };
}

function shouldActivatePointerHighlight(event) {
  return event.type === "pointerdown" || isFineHoverPointer(event);
}

function shouldClearPointerHighlightOnRelease(event) {
  return !isFineHoverPointer(event);
}

function isFineHoverPointer(event) {
  return event.pointerType === "mouse" && fineHoverMedia.matches;
}

function addPreviewPointerListeners({ onPointerStart, onHover, onLeave, trackMove = false }) {
  if (supportsPointerEvents) {
    document.addEventListener("pointerdown", onPointerStart);
    document.addEventListener("pointerover", onHover);
    if (trackMove) {
      document.addEventListener("pointermove", onHover);
    }
    document.addEventListener("pointerout", onLeave);
    return;
  }

  document.addEventListener("mousedown", onPointerStart);
  document.addEventListener("mouseover", onHover);
  if (trackMove) {
    document.addEventListener("mousemove", onHover);
  }
  document.addEventListener("mouseout", onLeave);
}

function initSdkIconPreview() {
  let preview = null;
  let activeIcon = null;
  let activePinned = false;
  let lastPointerType = "";

  const ensurePreview = () => {
    if (preview) {
      return preview;
    }

    preview = document.createElement("div");
    preview.className = "sdk-icon-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.hidden = true;
    document.body.append(preview);
    return preview;
  };

  const getPreviewGraphic = (icon) => {
    const graphic = icon.querySelector(".sdk-icon__image, .sdk-icon__svg");
    if (!graphic) {
      return null;
    }

    const clone = graphic.cloneNode(true);
    if (clone instanceof HTMLImageElement) {
      clone.alt = "";
    }
    return clone;
  };

  const positionPreview = (icon) => {
    const popup = ensurePreview();
    const iconRect = icon.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const popupWidth = popupRect.width || 96;
    const popupHeight = popupRect.height || 96;

    let left = iconRect.left + iconRect.width / 2 - popupWidth / 2;
    left = clamp(left, margin, window.innerWidth - popupWidth - margin);

    let top = iconRect.top - popupHeight - gap;
    if (top < margin) {
      top = iconRect.bottom + gap;
    }
    top = clamp(top, margin, window.innerHeight - popupHeight - margin);

    popup.style.setProperty("--preview-x", `${left}px`);
    popup.style.setProperty("--preview-y", `${top}px`);
  };

  const hidePreview = () => {
    if (!preview) {
      return;
    }

    preview.classList.remove("is-visible", "is-mono", "is-pinned");
    activeIcon = null;
    activePinned = false;
    window.setTimeout(() => {
      if (!activeIcon && preview) {
        preview.hidden = true;
      }
    }, 120);
  };

  const showPreview = (icon, options = {}) => {
    const pinned = Boolean(options.pinned);
    if (activeIcon === icon) {
      activePinned = activePinned || pinned;
      ensurePreview().classList.toggle("is-pinned", activePinned);
      positionPreview(icon);
      return;
    }

    const graphic = getPreviewGraphic(icon);
    if (!graphic) {
      hidePreview();
      return;
    }

    const popup = ensurePreview();
    popup.hidden = false;
    popup.classList.remove("is-visible", "is-mono");
    popup.classList.toggle("is-mono", icon.classList.contains("sdk-icon--mono"));
    popup.classList.toggle("is-pinned", pinned);
    popup.replaceChildren(graphic);
    activeIcon = icon;
    activePinned = pinned;
    positionPreview(icon);
    window.requestAnimationFrame(() => {
      if (activeIcon === icon) {
        popup.classList.add("is-visible");
      }
    });
  };

  const handleHoverEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const icon = event.target.closest?.(".sdk-icon");
    if (!icon) {
      if (activeIcon) {
        hidePreview();
      }
      return;
    }

    if (icon === activeIcon) {
      return;
    }

    showPreview(icon);
  };

  const handleLeaveEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const icon = event.target.closest?.(".sdk-icon");
    if (!icon || icon !== activeIcon) {
      return;
    }

    if (event.relatedTarget && icon.contains(event.relatedTarget)) {
      return;
    }

    hidePreview();
  };

  addPreviewPointerListeners({
    onPointerStart(event) {
      lastPointerType = event.pointerType || "";
    },
    onHover: handleHoverEvent,
    onLeave: handleLeaveEvent,
  });
  document.addEventListener("click", (event) => {
    const icon = event.target.closest?.(".sdk-icon");
    if (icon) {
      showPreview(icon, { pinned: true });
      return;
    }

    if (activePinned && !event.target.closest?.(".sdk-icon-preview")) {
      hidePreview();
    }
  });

  window.addEventListener("scroll", () => {
    if (activeIcon) {
      positionPreview(activeIcon);
    }
  }, true);

  window.addEventListener("resize", hidePreview);
}

function initSdkRulePreview() {
  let preview = null;
  let activeLabel = null;
  let activePinned = false;
  let hideTimer = null;
  let lastPointerType = "";

  const ensurePreview = () => {
    if (preview) {
      return preview;
    }

    preview = document.createElement("div");
    preview.className = "sdk-rule-preview";
    preview.setAttribute("role", "tooltip");
    preview.setAttribute("aria-hidden", "true");
    preview.hidden = true;
    preview.addEventListener("pointerenter", () => {
      cancelScheduledHide();
    });
    preview.addEventListener("mouseenter", () => {
      cancelScheduledHide();
    });
    preview.addEventListener("pointerleave", () => {
      scheduleHidePreview();
    });
    preview.addEventListener("mouseleave", () => {
      scheduleHidePreview();
    });
    preview.addEventListener("focusin", () => {
      cancelScheduledHide();
    });
    preview.addEventListener("focusout", (event) => {
      if (!event.relatedTarget || !preview.contains(event.relatedTarget)) {
        scheduleHidePreview();
      }
    });
    document.body.append(preview);
    return preview;
  };

  const positionPreview = (label) => {
    const popup = ensurePreview();
    const labelRect = label.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 10;
    const margin = 8;
    const popupWidth = popupRect.width || 360;
    const popupHeight = popupRect.height || 180;

    let left = labelRect.left + labelRect.width / 2 - popupWidth / 2;
    left = clamp(left, margin, window.innerWidth - popupWidth - margin);

    let top = labelRect.bottom + gap;
    if (top + popupHeight > window.innerHeight - margin) {
      top = labelRect.top - popupHeight - gap;
    }
    top = clamp(top, margin, window.innerHeight - popupHeight - margin);

    popup.style.setProperty("--rule-preview-x", `${left}px`);
    popup.style.setProperty("--rule-preview-y", `${top}px`);
  };

  const hidePreview = () => {
    if (!preview) {
      return;
    }

    cancelScheduledHide();
    preview.classList.remove("is-visible", "is-pinned");
    preview.setAttribute("aria-hidden", "true");
    activeLabel = null;
    activePinned = false;
    window.setTimeout(() => {
      if (!activeLabel && preview) {
        preview.hidden = true;
      }
    }, 140);
  };

  const scheduleHidePreview = () => {
    if (activePinned) {
      return;
    }

    cancelScheduledHide();
    hideTimer = window.setTimeout(() => {
      const popup = ensurePreview();
      const activeElement = document.activeElement;
      if (
        activeLabel?.matches(":hover") ||
        popup.matches(":hover") ||
        activeElement?.closest?.(".sdk-rule-label.has-rule-detail") ||
        popup.contains(activeElement)
      ) {
        return;
      }

      hidePreview();
    }, 90);
  };

  const cancelScheduledHide = () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const showPreview = (label, options = {}) => {
    cancelScheduledHide();
    const pinned = Boolean(options.pinned);
    if (activeLabel === label) {
      const popup = ensurePreview();
      activePinned = activePinned || pinned;
      popup.classList.toggle("is-pinned", activePinned);
      positionPreview(label);
      return;
    }

    const detail = getRegisteredSdkRuleDetail(label.dataset.ruleDetailId);
    const content = buildRulePreviewContent(label, detail);
    if (!content) {
      hidePreview();
      return;
    }

    const popup = ensurePreview();
    popup.hidden = false;
    popup.classList.remove("is-visible", "is-pinned");
    popup.classList.toggle("is-pinned", pinned);
    popup.setAttribute("aria-hidden", "false");
    popup.replaceChildren(content);
    activeLabel = label;
    activePinned = pinned;
    positionPreview(label);
    window.requestAnimationFrame(() => {
      if (activeLabel === label) {
        popup.classList.add("is-visible");
      }
    });
  };

  const handleHoverEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    if (event.target.closest?.(".sdk-rule-preview")) {
      cancelScheduledHide();
      return;
    }

    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (!label) {
      if (activeLabel && !document.activeElement?.closest?.(".sdk-rule-label.has-rule-detail")) {
        scheduleHidePreview();
      }
      return;
    }

    showPreview(label);
  };

  const handleLeaveEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (!label || label !== activeLabel) {
      return;
    }

    if (event.relatedTarget && label.contains(event.relatedTarget)) {
      return;
    }

    if (event.relatedTarget && ensurePreview().contains(event.relatedTarget)) {
      cancelScheduledHide();
      return;
    }

    scheduleHidePreview();
  };

  addPreviewPointerListeners({
    onPointerStart(event) {
      lastPointerType = event.pointerType || "";
    },
    onHover: handleHoverEvent,
    onLeave: handleLeaveEvent,
  });
  document.addEventListener("click", (event) => {
    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (label) {
      showPreview(label, { pinned: true });
      return;
    }

    if (activePinned && !event.target.closest?.(".sdk-rule-preview")) {
      hidePreview();
    }
  });
  document.addEventListener("focusin", (event) => {
    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (label) {
      showPreview(label);
    }
  });
  document.addEventListener("focusout", (event) => {
    const label = event.target.closest?.(".sdk-rule-label.has-rule-detail");
    if (label && label === activeLabel) {
      if (event.relatedTarget && ensurePreview().contains(event.relatedTarget)) {
        cancelScheduledHide();
        return;
      }
      scheduleHidePreview();
    }
  });

  window.addEventListener("scroll", () => {
    if (activeLabel) {
      positionPreview(activeLabel);
    }
  }, true);

  window.addEventListener("resize", hidePreview);
}

function initArchiveChartPreview() {
  let preview = null;
  let activeSegment = null;
  let activePinned = false;
  let hideTimer = null;
  let lastPointerType = "";
  let lastPoint = null;

  const ensurePreview = () => {
    if (preview) {
      return preview;
    }

    preview = document.createElement("div");
    preview.className = "sdk-rule-preview archive-chart-preview";
    preview.setAttribute("role", "tooltip");
    preview.setAttribute("aria-hidden", "true");
    preview.hidden = true;
    document.body.append(preview);
    return preview;
  };

  const positionPreview = (segment, event = null) => {
    const popup = ensurePreview();
    const segmentRect = segment.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const gap = 14;
    const margin = 8;
    const popupWidth = popupRect.width || 300;
    const popupHeight = popupRect.height || 140;
    const x = Number.isFinite(event?.clientX)
      ? event.clientX
      : lastPoint?.x ?? segmentRect.left + segmentRect.width / 2;
    const y = Number.isFinite(event?.clientY)
      ? event.clientY
      : lastPoint?.y ?? segmentRect.top + segmentRect.height / 2;

    let left = x + gap;
    if (left + popupWidth > window.innerWidth - margin) {
      left = x - popupWidth - gap;
    }
    left = clamp(left, margin, window.innerWidth - popupWidth - margin);

    let top = y + gap;
    if (top + popupHeight > window.innerHeight - margin) {
      top = y - popupHeight - gap;
    }
    top = clamp(top, margin, window.innerHeight - popupHeight - margin);

    popup.style.setProperty("--rule-preview-x", `${left}px`);
    popup.style.setProperty("--rule-preview-y", `${top}px`);
  };

  const hidePreview = () => {
    if (!preview) {
      return;
    }

    cancelScheduledHide();
    preview.classList.remove("is-visible", "is-pinned");
    preview.setAttribute("aria-hidden", "true");
    activeSegment?.classList.remove("is-active");
    activeSegment = null;
    activePinned = false;
    lastPoint = null;
    window.setTimeout(() => {
      if (!activeSegment && preview) {
        preview.hidden = true;
      }
    }, 140);
  };

  const scheduleHidePreview = () => {
    if (activePinned) {
      return;
    }

    cancelScheduledHide();
    hideTimer = window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (
        activeSegment?.matches(":hover") ||
        activeElement?.closest?.(".archive-chart-segment")
      ) {
        return;
      }

      hidePreview();
    }, 80);
  };

  const cancelScheduledHide = () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const showPreview = (segment, event = null, options = {}) => {
    cancelScheduledHide();
    if (Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)) {
      lastPoint = { x: event.clientX, y: event.clientY };
    }

    const popup = ensurePreview();
    const pinned = Boolean(options.pinned);
    if (activeSegment === segment) {
      activePinned = activePinned || pinned;
      popup.classList.toggle("is-pinned", activePinned);
      segment.classList.add("is-active");
      positionPreview(segment, event);
      return;
    }

    const content = buildArchiveChartPreviewContent(segment);
    if (!content) {
      hidePreview();
      return;
    }

    popup.style.setProperty("--archive-segment-color", segment.dataset.archiveColor || "var(--accent)");
    activeSegment?.classList.remove("is-active");
    popup.hidden = false;
    popup.classList.remove("is-visible", "is-pinned");
    popup.classList.toggle("is-pinned", pinned);
    popup.setAttribute("aria-hidden", "false");
    popup.replaceChildren(content);
    activeSegment = segment;
    activeSegment.classList.add("is-active");
    activePinned = pinned;
    positionPreview(segment, event);
    window.requestAnimationFrame(() => {
      if (activeSegment === segment) {
        popup.classList.add("is-visible");
      }
    });
  };

  const handleHoverEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const segment = event.target.closest?.(".archive-chart-segment");
    if (!segment) {
      if (activeSegment && !document.activeElement?.closest?.(".archive-chart-segment")) {
        scheduleHidePreview();
      }
      return;
    }

    showPreview(segment, event);
  };

  const handleLeaveEvent = (event) => {
    if (shouldUseTapPopups(event.pointerType || lastPointerType) || activePinned) {
      return;
    }

    const segment = event.target.closest?.(".archive-chart-segment");
    if (!segment || segment !== activeSegment) {
      return;
    }

    if (event.relatedTarget && segment.contains(event.relatedTarget)) {
      return;
    }

    scheduleHidePreview();
  };

  addPreviewPointerListeners({
    onPointerStart(event) {
      lastPointerType = event.pointerType || "";
    },
    onHover: handleHoverEvent,
    onLeave: handleLeaveEvent,
    trackMove: true,
  });
  document.addEventListener("click", (event) => {
    const segment = event.target.closest?.(".archive-chart-segment");
    if (segment) {
      showPreview(segment, event, { pinned: true });
      return;
    }

    if (activePinned) {
      hidePreview();
    }
  });
  document.addEventListener("focusin", (event) => {
    const segment = event.target.closest?.(".archive-chart-segment");
    if (segment) {
      showPreview(segment);
    }
  });
  document.addEventListener("focusout", (event) => {
    const segment = event.target.closest?.(".archive-chart-segment");
    if (segment && segment === activeSegment) {
      scheduleHidePreview();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeSegment) {
      hidePreview();
    }
  });

  window.addEventListener("scroll", () => {
    if (activeSegment) {
      positionPreview(activeSegment);
    }
  }, true);

  window.addEventListener("resize", hidePreview);
}

function shouldUseTapPopups(pointerType = "") {
  return (
    pointerType === "touch" ||
    pointerType === "pen" ||
    tapPopupMedia.matches
  );
}

function buildRulePreviewContent(label, detail) {
  const localized = selectRuleDetailLocale(detail);
  if (!localized) {
    return null;
  }

  const title = localized.label || label.textContent?.trim() || t("unknown");
  const root = document.createElement("div");
  root.className = "sdk-rule-preview-card";

  const titleNode = document.createElement("div");
  titleNode.className = "sdk-rule-preview-title";
  titleNode.textContent = title;
  root.append(titleNode);

  if (localized.description) {
    const descriptionNode = document.createElement("div");
    descriptionNode.className = "sdk-rule-preview-description";
    descriptionNode.textContent = localized.description;
    root.append(descriptionNode);
  }

  const metaRows = [];
  if (localized.team) {
    metaRows.push([t("ruleDevTeam"), createTextNode(localized.team)]);
  }
  if (localized.contributors?.length) {
    metaRows.push([t("ruleContributors"), createContributorLinks(localized.contributors)]);
  }
  if (localized.source) {
    metaRows.push([t("ruleSource"), createSourceLink(localized.source)]);
  }
  if (detail?.uuid) {
    metaRows.push([t("ruleUuid"), createTextNode(detail.uuid)]);
  }

  if (metaRows.length) {
    const metaNode = document.createElement("div");
    metaNode.className = "sdk-rule-preview-meta";
    for (const [name, value] of metaRows) {
      const row = document.createElement("div");
      row.className = "sdk-rule-preview-meta-row";

      const nameNode = document.createElement("span");
      nameNode.textContent = name;

      const valueNode = document.createElement("span");
      valueNode.append(value);

      row.append(nameNode, valueNode);
      metaNode.append(row);
    }
    root.append(metaNode);
  }

  return root;
}

function buildArchiveChartPreviewContent(segment) {
  const root = document.createElement("div");
  root.className = "sdk-rule-preview-card";

  const titleNode = document.createElement("div");
  titleNode.className = "sdk-rule-preview-title";
  titleNode.textContent = segment.dataset.archiveName || t("unknown");
  root.append(titleNode);

  const metaNode = document.createElement("div");
  metaNode.className = "sdk-rule-preview-meta";
  const metaRows = [
    [t("size"), segment.dataset.archiveSize || t("unknown")],
    [t("archiveDistributionPercent"), segment.dataset.archivePercent || t("unknown")],
  ];

  for (const [name, value] of metaRows) {
    const row = document.createElement("div");
    row.className = "sdk-rule-preview-meta-row";

    const nameNode = document.createElement("span");
    nameNode.textContent = name;

    const valueNode = document.createElement("span");
    valueNode.append(createTextNode(value));

    row.append(nameNode, valueNode);
    metaNode.append(row);
  }
  root.append(metaNode);

  return root;
}

function createTextNode(value) {
  return document.createTextNode(String(value || ""));
}

function createContributorLinks(contributors = []) {
  const fragment = document.createDocumentFragment();
  contributors.forEach((contributor, index) => {
    if (index > 0) {
      fragment.append(document.createTextNode(", "));
    }

    const link = createGithubProfileLink(contributor);
    fragment.append(link || document.createTextNode(String(contributor || "")));
  });
  return fragment;
}

function createGithubProfileLink(contributor) {
  const displayName = String(contributor || "").trim();
  const username = CONTRIBUTOR_GITHUB_ALIASES.get(displayName.toLowerCase()) || displayName;
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/iu.test(username)) {
    return null;
  }

  return createExternalLink(`https://github.com/${username}`, displayName);
}

function createSourceLink(source) {
  const value = String(source || "").trim();
  const safeUrl = normalizeExternalUrl(value);
  return safeUrl ? createExternalLink(safeUrl, value) : createTextNode(value);
}

function createExternalLink(href, text) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = text;
  return link;
}

function normalizeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function selectRuleDetailLocale(detail) {
  const locales = detail?.locales;
  if (!locales || typeof locales !== "object") {
    return null;
  }

  return (
    locales[state.locale] ||
    locales["zh-Hans"] ||
    locales["zh-CN"] ||
    locales.en ||
    Object.values(locales).find((item) => item && typeof item === "object") ||
    null
  );
}


function initColorOrbBackground() {
  elements.backgroundCanvas?.setAttribute("data-renderer", "css-mesh");
}

function setAppMode(mode) {
  const nextMode = VALID_APP_MODES.has(mode) ? mode : "analyze";
  if (state.appMode === nextMode) {
    return;
  }

  state.appMode = nextMode;
  updateAppMode();
  trackWebEvent("webui.mode.changed", {
    result: "success",
    operation: nextMode,
  });
}

function updateAppMode() {
  const isCompare = state.appMode === "compare";
  elements.modeButtons.forEach((button) => {
    const isActive = button.dataset.appMode === state.appMode;
    button.classList.toggle("is-active", isActive);
    button.classList.remove("is-pending");
    button.setAttribute("aria-checked", isActive ? "true" : "false");
  });
  updateModeIndicator();

  elements.form.hidden = isCompare;
  elements.historyPanel.hidden = isCompare;
  if (compareController) {
    compareController.setVisible(isCompare);
  } else {
    elements.compareView.hidden = true;
    if (isCompare) {
      loadCompareControllerForCurrentMode();
    }
  }

  if (isCompare) {
    elements.emptyState.hidden = true;
    elements.resultView.hidden = true;
  } else {
    renderReport();
  }
  updateClearButton();
}

function updateClearButton() {
  if (state.appMode === "compare") {
    elements.clearButton.disabled = !compareController?.hasContent();
    return;
  }

  elements.clearButton.disabled = !state.selectedFile && !state.report;
}

function updateModeIndicator(appMode = state.appMode) {
  pendingModeIndicatorAppMode = appMode;
  if (modeIndicatorFrame || !elements.modeChipGroup) {
    return;
  }

  modeIndicatorFrame = window.requestAnimationFrame(() => {
    modeIndicatorFrame = 0;
    const indicatorAppMode = pendingModeIndicatorAppMode || state.appMode;
    const activeButton = elements.modeButtons.find((button) => button.dataset.appMode === indicatorAppMode);
    if (!activeButton || !elements.modeChipGroup) {
      return;
    }

    const groupRect = elements.modeChipGroup.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const groupStyle = getComputedStyle(elements.modeChipGroup);
    const borderLeft = Number.parseFloat(groupStyle.borderLeftWidth) || 0;
    elements.modeChipGroup.style.setProperty("--mode-indicator-x", `${(buttonRect.left - groupRect.left - borderLeft).toFixed(1)}px`);
    elements.modeChipGroup.style.setProperty("--mode-indicator-width", `${buttonRect.width.toFixed(1)}px`);
    elements.modeChipGroup.style.setProperty("--mode-indicator-height", `${buttonRect.height.toFixed(1)}px`);
  });
}

function clearModePendingButtons() {
  elements.modeButtons.forEach((button) => {
    button.classList.remove("is-pending");
  });
}


function readThemeChoice() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_CHOICES.has(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function applyThemeChoice(choice, options = {}) {
  const previousChoice = state.themeChoice;
  const themeChoice = THEME_CHOICES.has(choice) ? choice : "system";
  const shouldPersist = options.persist !== false;
  state.themeChoice = themeChoice;

  document.documentElement.dataset.themeChoice = themeChoice;
  document.documentElement.dataset.colorScheme = resolveColorScheme(themeChoice);
  window.dispatchEvent(new Event("apk-theme-change"));

  elements.themeButtons.forEach((button) => {
    const isActive = button.dataset.themeChoice === themeChoice;
    button.classList.toggle("is-active", isActive);
    button.classList.remove("is-pending");
    button.setAttribute("aria-checked", isActive ? "true" : "false");
  });
  updateThemeIndicator();

  if (!shouldPersist) {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeChoice);
  } catch {
    // Theme persistence is optional; the UI still reflects the current choice.
  }

  if (previousChoice !== themeChoice) {
    trackWebEvent("webui.theme.changed", {
      result: "success",
      operation: themeChoice,
    });
  }
}

function updateThemeIndicator(themeChoice = state.themeChoice) {
  pendingThemeIndicatorChoice = themeChoice;
  if (themeIndicatorFrame || !elements.themeChipGroup) {
    return;
  }

  themeIndicatorFrame = window.requestAnimationFrame(() => {
    themeIndicatorFrame = 0;
    const indicatorThemeChoice = pendingThemeIndicatorChoice || state.themeChoice;
    const activeButton = elements.themeButtons.find((button) => button.dataset.themeChoice === indicatorThemeChoice);
    if (!activeButton || !elements.themeChipGroup) {
      return;
    }

    const groupRect = elements.themeChipGroup.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const groupStyle = getComputedStyle(elements.themeChipGroup);
    const borderLeft = Number.parseFloat(groupStyle.borderLeftWidth) || 0;
    elements.themeChipGroup.style.setProperty("--theme-indicator-x", `${(buttonRect.left - groupRect.left - borderLeft).toFixed(1)}px`);
    elements.themeChipGroup.style.setProperty("--theme-indicator-width", `${buttonRect.width.toFixed(1)}px`);
    elements.themeChipGroup.style.setProperty("--theme-indicator-height", `${buttonRect.height.toFixed(1)}px`);
  });
}

function clearThemePendingButtons() {
  elements.themeButtons.forEach((button) => {
    button.classList.remove("is-pending");
  });
}

function resolveColorScheme(choice) {
  if (choice === "dark" || choice === "light") {
    return choice;
  }

  return systemThemeMedia.matches ? "dark" : "light";
}


function applyLocale() {
  document.documentElement.lang = state.locale;
  document.title = t("title");

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  document.querySelectorAll("[data-title-i18n]").forEach((node) => {
    const value = t(node.dataset.titleI18n);
    node.title = value;
    node.setAttribute("aria-label", value);
  });

  document.querySelectorAll("[data-aria-i18n]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.ariaI18n));
  });
}

function renderLanguageOptions() {
  const locales = getSupportedLocales();
  elements.languageSelect.innerHTML = locales
    .map((item) => {
      const selected = item.locale === state.locale ? " selected" : "";
      return `<option value="${escapeAttr(item.locale)}"${selected}>${escapeHtml(item.nativeName)}</option>`;
    })
    .join("");
}

function setSelectedFile(file) {
  hideError();
  state.selectedFile = file;
  renderSelectedFile();
  elements.analyzeButton.disabled = !file;
  updateClearButton();

  if (file) {
    const isValid = isLikelyApk(file);
    trackWebEvent("webui.file.selected", {
      result: isValid ? "valid" : "invalid",
      is_valid: isValid,
      ...getFileAnalyticsFields(file),
    });
  }
}

function renderSelectedFile() {
  const file = state.selectedFile;
  if (!file) {
    elements.fileMeta.textContent = t("fileIdle");
    return;
  }

  elements.fileMeta.textContent = t("selectedFile", {
    name: file.name || "local.apk",
    size: formatBytes(file.size || 0),
  });
}

async function analyzeSelectedFile() {
  const file = state.selectedFile;
  hideError();

  if (!file) {
    showError(t("noFile"));
    trackWebEvent("webui.analysis.failed", {
      result: "missing_file",
      error_name: "MissingFile",
    });
    return;
  }

  if (!isLikelyApk(file)) {
    showError(t("invalidFile"));
    trackWebEvent("webui.analysis.failed", {
      result: "invalid_file",
      error_name: "InvalidFile",
      ...getFileAnalyticsFields(file),
    });
    return;
  }

  const worker = ensureWorker();
  if (!worker) {
    showError(t("workerFailed"));
    trackWebEvent("webui.analysis.failed", {
      result: "worker_unavailable",
      error_name: "WorkerUnavailable",
      ...getFileAnalyticsFields(file),
    });
    return;
  }

  state.jobId += 1;
  const jobId = state.jobId;
  state.startedAt = performance.now();
  state.report = null;
  state.activeTab = "summary";
  state.activeNativeAbi = "";
  state.activeAnalyzeJobId = jobId;
  state.jobs.set(jobId, {
    type: "analyze",
  });

  setBusy(true);
  showProgress("progressReading");
  startTimer();
  trackWebEvent("webui.analysis.started", {
    result: "started",
    input_source: "upload",
    ...getFileAnalyticsFields(file),
  });

  const terminalSystem = await detectCurrentTerminalSystem();

  if (!state.jobs.has(jobId)) {
    return;
  }

  worker.postMessage({
    type: "analyze",
    jobId,
    locale: state.locale,
    file,
    terminalSystem,
  });
}

function ensureWorker() {
  cancelWorkerIdleTermination();
  if (state.worker) {
    return state.worker;
  }

  try {
    const worker = new Worker(new URL("./analyzer-worker.js", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
      failActiveWorkerJobs(event.message || t("workerFailed"));
    });
    state.worker = worker;
    return worker;
  } catch {
    return null;
  }
}

function failActiveWorkerJobs(message) {
  const jobs = [...state.jobs.entries()];
  state.jobs.clear();
  cancelWorkerIdleTermination();
  state.worker = null;

  for (const [, job] of jobs) {
    if (job.type === "compare") {
      compareController?.finishJob(job.slotKey, null, message);
    } else {
      finishAnalysis();
      state.activeAnalyzeJobId = null;
      showError(message);
      trackWebEvent("webui.analysis.failed", {
        result: "worker_error",
        error_name: "AnalyzerWorkerError",
      });
    }
  }
}

function handleWorkerMessage(event) {
  const message = event.data || {};
  const job = state.jobs.get(message.jobId);
  if (!job) {
    return;
  }

  if (message.type === "progress") {
    if (job.type === "compare") {
      compareController?.handleProgress(
        job.slotKey,
        message.jobId,
        message.stage === "parsing" ? "progressParsing" : "progressReading",
      );
    } else {
      showProgress(message.stage === "parsing" ? "progressParsing" : "progressReading");
    }
    return;
  }

  if (message.type === "error") {
    state.jobs.delete(message.jobId);
    scheduleWorkerIdleTermination();
    if (job.type === "compare") {
      compareController?.finishJob(job.slotKey, null, message.error || t("workerFailed"));
    } else {
      finishAnalysis();
      state.activeAnalyzeJobId = null;
      showError(message.error || t("workerFailed"));
      trackWebEvent("webui.analysis.failed", {
        result: "error",
        error_name: "AnalyzerWorkerError",
      });
    }
    return;
  }

  if (message.type === "result") {
    state.jobs.delete(message.jobId);
    if (job.type === "compare") {
      compareController?.finishJob(job.slotKey, message.report, "");
      saveHistoryReport(message.report);
      scheduleWorkerIdleTermination();
      return;
    }

    finishAnalysis();
    state.activeAnalyzeJobId = null;
    state.report = message.report;
    state.activeNativeAbi = "";
    saveHistoryReport(message.report);
    updateClearButton();
    showProgress("progressDone");
    renderReport();
    trackWebEvent("webui.analysis.succeeded", {
      result: "success",
      input_source: "upload",
      ...getReportAnalyticsFields(message.report),
    });
    scheduleWorkerIdleTermination();
  }
}

function cancelWorkerIdleTermination() {
  if (state.workerIdleTimer) {
    window.clearTimeout(state.workerIdleTimer);
    state.workerIdleTimer = null;
  }
}

function scheduleWorkerIdleTermination() {
  cancelWorkerIdleTermination();
  if (!state.worker || state.jobs.size > 0) {
    return;
  }

  state.workerIdleTimer = window.setTimeout(() => {
    state.workerIdleTimer = null;
    if (state.worker && state.jobs.size === 0) {
      state.worker.terminate();
      state.worker = null;
    }
  }, WORKER_IDLE_TERMINATE_MS);
}

function finishAnalysis() {
  setBusy(false);
  stopTimer();
}

function setBusy(isBusy) {
  elements.analyzeButton.disabled = isBusy || !state.selectedFile;
  if (elements.analyzeButtonLabel) {
    elements.analyzeButtonLabel.textContent = isBusy ? t("analyzing") : t("analyze");
  }
}

function showProgress(key) {
  elements.progress.hidden = false;
  elements.progress.classList.toggle("is-complete", key === "progressDone");
  elements.progressLabel.textContent = t(key);
  updateElapsed();
}

function startTimer() {
  stopTimer();
  state.timer = window.setInterval(updateElapsed, 120);
}

function stopTimer() {
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
}

function updateElapsed() {
  const elapsed = state.startedAt ? (performance.now() - state.startedAt) / 1000 : 0;
  const text = `${elapsed.toFixed(1)}s`;
  if (elements.progressTime.textContent !== text) {
    elements.progressTime.textContent = text;
  }
}

function resetState() {
  const hadContent = Boolean(state.selectedFile || state.report || state.activeAnalyzeJobId != null);
  if (state.activeAnalyzeJobId != null) {
    state.jobs.delete(state.activeAnalyzeJobId);
    state.activeAnalyzeJobId = null;
  }
  scheduleWorkerIdleTermination();
  stopTimer();
  hideError();
  state.selectedFile = null;
  state.report = null;
  state.activeTab = "summary";
  state.activeNativeAbi = "";
  elements.fileInput.value = "";
  elements.progress.hidden = true;
  elements.progress.classList.remove("is-complete");
  elements.progressTime.textContent = "0.0s";
  elements.progressLabel.textContent = t("progressReady");
  elements.analyzeButton.disabled = true;
  renderSelectedFile();
  updateClearButton();
  renderReport();

  if (hadContent) {
    trackWebEvent("webui.analysis.reset", {
      result: "success",
    });
  }
}

function showError(message) {
  elements.errorBox.hidden = false;
  elements.errorBox.textContent = message;
}

function hideError() {
  elements.errorBox.hidden = true;
  elements.errorBox.textContent = "";
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "";
}

function getErrorName(error) {
  return error instanceof Error ? (error.name || "Error") : "UnknownError";
}

function cloneReportForHydration(report) {
  if (typeof structuredClone === "function") {
    return structuredClone(report);
  }

  return JSON.parse(JSON.stringify(report));
}

function saveHistoryReport(report) {
  const entry = createHistoryEntry(report);
  const nextHistory = [entry];
  for (const item of state.history) {
    if (item.key !== entry.key) {
      nextHistory.push(item);
    }
  }

  state.history = persistHistory(nextHistory, { normalized: true });
  renderHistoryList();
}

async function openHistoryItem(id) {
  if (state.loadingHistoryId) {
    return;
  }

  const entry = state.history.find((item) => item.id === id);
  if (!entry?.report) {
    return;
  }

  const token = historyOpenToken + 1;
  historyOpenToken = token;
  setHistoryLoadingId(id);
  hideError();
  stopTimer();

  try {
    const report = await hydrateReportSdkIcons(cloneReportForHydration(entry.report));
    if (token !== historyOpenToken) {
      return;
    }

    state.report = report;
    state.activeTab = "summary";
    state.activeNativeAbi = "";
    elements.progress.hidden = true;
    elements.progress.classList.remove("is-complete");
    elements.progressTime.textContent = "0.0s";
    elements.progressLabel.textContent = t("progressReady");
    updateClearButton();
    renderReport();
    trackWebEvent("webui.history.opened", {
      result: "success",
      input_source: "history",
      ...getReportAnalyticsFields(state.report),
    });
  } catch (error) {
    if (token !== historyOpenToken) {
      return;
    }

    showError(getErrorMessage(error) || t("unknownError"));
    trackWebEvent("webui.history.open_failed", {
      result: "error",
      error_name: getErrorName(error),
      input_source: "history",
    });
  } finally {
    if (token === historyOpenToken) {
      setHistoryLoadingId("");
    }
  }
}

function deleteHistoryItem(id) {
  if (state.loadingHistoryId) {
    return;
  }

  const previousCount = state.history.length;
  const nextHistory = [];
  for (const item of state.history) {
    if (item.id !== id) {
      nextHistory.push(item);
    }
  }

  state.history = persistHistory(nextHistory, { normalized: true });
  renderHistoryList();
  trackWebEvent("webui.history.deleted", {
    result: "success",
    history_count: state.history.length,
    value: Math.max(0, previousCount - state.history.length),
  });
}

function clearHistory() {
  if (state.loadingHistoryId) {
    return;
  }

  const previousCount = state.history.length;
  state.history = persistHistory([]);
  renderHistoryList();
  trackWebEvent("webui.history.cleared", {
    result: "success",
    history_count: 0,
    value: previousCount,
  });
}

function setHistoryCollapsed(isCollapsed, options = {}) {
  state.historyCollapsed = Boolean(isCollapsed);
  elements.historyPanel.classList.toggle("is-collapsed", state.historyCollapsed);
  elements.historyContent.hidden = state.historyCollapsed;
  elements.historyToggleButton.setAttribute("aria-expanded", state.historyCollapsed ? "false" : "true");

  const label = t(state.historyCollapsed ? "historyExpand" : "historyCollapse");
  elements.historyToggleButton.title = label;
  elements.historyToggleButton.setAttribute("aria-label", label);

  if (options.persist === false) {
    return;
  }

  persistHistoryCollapsed(state.historyCollapsed);
  trackWebEvent("webui.history.toggled", {
    result: state.historyCollapsed ? "collapsed" : "expanded",
    operation: state.historyCollapsed ? "collapse" : "expand",
  });
}

function updateHistoryCollapse() {
  setHistoryCollapsed(state.historyCollapsed, { persist: false });
}

function setHistoryLoadingId(id) {
  state.loadingHistoryId = id || "";
  const isLoading = Boolean(state.loadingHistoryId);
  document.documentElement.classList.toggle("is-history-loading", isLoading);
  elements.historyList.classList.toggle("is-loading", isLoading);
  renderHistoryList();
}

function renderHistoryList() {
  const isHistoryLoading = Boolean(state.loadingHistoryId);
  elements.clearHistoryButton.disabled = state.history.length === 0 || isHistoryLoading;

  if (state.history.length === 0) {
    elements.historyList.innerHTML = emptyList(t("historyEmpty"));
    renderCompareHistoryOptionsIfLoaded();
    return;
  }

  elements.historyList.innerHTML = state.history.map(renderHistoryItem).join("");
  renderCompareHistoryOptionsIfLoaded();
}

function renderHistoryItem(entry) {
  const isLoading = entry.id === state.loadingHistoryId;
  const isHistoryLoading = Boolean(state.loadingHistoryId);
  const summary = entry.summary || buildHistorySummary(entry.report);
  const title = summary.appName || summary.packageName || t("unknown");
  const icon = renderHistoryIcon(summary);
  const packageName = summary.packageName || t("unknown");
  const version = summary.versionName ? `${t("versionName")}: ${summary.versionName}` : t("unknown");
  const targetSdk = summary.targetSdk || t("unknown");
  const file = summary.fileName || t("unknown");
  const size = formatBytes(summary.fileSizeBytes || 0);
  const date = formatDate(summary.analyzedAt || entry.savedAt);
  const stats = summary.stats || {};
  const statText = [
    `${t("sdk")}: ${summary.sdkCount || 0}`,
    `${t("nativeLibraries")}: ${stats.nativeLibraries || 0}`,
    `${t("components")}: ${stats.components || 0}`,
  ].join(" · ");

  return [
    `<article class="history-row${isLoading ? " is-loading" : ""}" aria-busy="${isLoading ? "true" : "false"}">`,
    `<button class="history-main" type="button" data-history-action="open" data-history-id="${escapeAttr(entry.id)}" aria-label="${escapeAttr(t("historyOpen"))}" aria-disabled="${isHistoryLoading ? "true" : "false"}">`,
    icon,
    `<span class="history-copy">`,
    `<span class="history-title">${escapeHtml(title)}</span>`,
    `<span class="history-package">${escapeHtml(packageName)}</span>`,
    `<span class="history-meta">${escapeHtml(t("historyItemMeta", { version, targetSdk }))}</span>`,
    `<span class="history-meta">${escapeHtml(t("historyFileMeta", { file, size, date }))}</span>`,
    `<span class="history-meta">${escapeHtml(statText)}</span>`,
    `<span class="history-loading" aria-live="polite">`,
    `<span class="history-loading-spinner" aria-hidden="true"></span>`,
    `<span>${escapeHtml(t("historyOpening"))}</span>`,
    `</span>`,
    `</span>`,
    `</button>`,
    `<button class="icon-button history-delete" type="button" data-history-action="delete" data-history-id="${escapeAttr(entry.id)}" aria-label="${escapeAttr(t("historyDelete"))}" title="${escapeAttr(t("historyDelete"))}" aria-disabled="${isHistoryLoading ? "true" : "false"}">`,
    `<svg viewBox="0 0 24 24" aria-hidden="true">`,
    `<path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4a1 1 0 1 1 0-2h4V4a1 1 0 0 1 1-1Zm1 2h4V5h-4Zm-3 2v12h10V7H7Zm3 3a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Z"></path>`,
    `</svg>`,
    `</button>`,
    `</article>`,
  ].join("");
}

function renderHistoryIcon(summary) {
  const src = sanitizeImageSrc(summary.iconDataUri || "");
  if (src) {
    return `<img class="history-icon" src="${escapeAttr(src)}" alt="${escapeAttr(summary.appName || t("appName"))}">`;
  }

  return `<span class="history-icon history-icon-placeholder" aria-hidden="true">${escapeHtml(getInitial(summary.appName || summary.packageName))}</span>`;
}

function renderReport() {
  if (state.appMode !== "analyze") {
    elements.emptyState.hidden = true;
    elements.resultView.hidden = true;
    return;
  }

  if (!state.report) {
    elements.emptyState.hidden = false;
    elements.resultView.hidden = true;
    elements.reportHero.innerHTML = "";
    elements.archiveDistribution.innerHTML = "";
    elements.archiveDistribution.hidden = true;
    elements.resultView.classList.remove("has-archive-distribution");
    elements.tabPanel.innerHTML = "";
    return;
  }

  elements.emptyState.hidden = true;
  elements.resultView.hidden = false;
  elements.reportHero.innerHTML = renderHero(state.report);
  const archiveDistribution = renderArchiveDistribution(state.report);
  elements.archiveDistribution.innerHTML = archiveDistribution;
  elements.archiveDistribution.hidden = !archiveDistribution;
  elements.resultView.classList.toggle("has-archive-distribution", Boolean(archiveDistribution));
  initReportTitleColorMask(elements.reportHero, state.report.apkInfo);
  updateTabs();
  renderTabPanel();
}

function updateTabs() {
  elements.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === state.activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function renderTabPanel() {
  const report = state.report;
  if (!report) {
    return;
  }

  if (state.activeTab === "sdk") {
    elements.tabPanel.innerHTML = renderSdkTab(report);
  } else if (state.activeTab === "native") {
    elements.tabPanel.innerHTML = renderNativeTab(report);
  } else if (state.activeTab === "components") {
    elements.tabPanel.innerHTML = renderComponentsTab(report);
  } else if (state.activeTab === "permissions") {
    elements.tabPanel.innerHTML = renderPermissionsTab(report);
  } else if (state.activeTab === "signatures") {
    elements.tabPanel.innerHTML = renderSignaturesTab(report);
  } else if (state.activeTab === "metadata") {
    elements.tabPanel.innerHTML = renderMetaDataTab(report);
  } else if (state.activeTab === "raw") {
    elements.tabPanel.innerHTML = renderRawTab(report);
  } else {
    elements.tabPanel.innerHTML = renderSummaryTab(report);
  }
}

function renderHero(report) {
  const info = report.apkInfo;
  return [
    renderAppIcon(info),
    `<div class="hero-copy">`,
    renderAppTitle(info.appName || t("unknown")),
    `<div class="hero-meta">`,
    chip(info.packageName || t("unknown")),
    chip(`${t("versionName")}: ${info.versionName || t("unknown")}`),
    chip(`${t("targetSdk")}: ${info.targetSdk || t("unknown")}`),
    chip(t("localFile")),
    `</div>`,
    `</div>`,
  ].join("");
}

function renderArchiveDistribution(report) {
  const entries = getArchiveDistributionEntries(report.apkInfo?.archive);
  if (entries.length < 2) {
    return "";
  }

  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalSize <= 0) {
    return "";
  }

  return [
    `<section class="archive-chart" aria-label="${escapeAttr(t("archiveDistributionTitle"))}">`,
    `<div class="archive-chart-copy">`,
    `<h3>${escapeHtml(t("archiveDistributionTitle"))}</h3>`,
    `<p>${escapeHtml(t("archiveDistributionSummary", { count: entries.length, size: formatBytes(totalSize) }))}</p>`,
    `</div>`,
    `<div class="archive-chart-body">`,
    renderArchivePieChart(entries, totalSize),
    `</div>`,
    `</section>`,
  ].join("");
}

function getArchiveDistributionEntries(archive) {
  if (!archive || archive.type !== "package-container" || !Array.isArray(archive.apkEntryDetails)) {
    return [];
  }

  return archive.apkEntryDetails
    .map((entry) => {
      const path = String(entry.path || "");
      const name = String(entry.name || getFileNameFromPath(path) || t("unknown"));
      const size = Number(entry.size ?? entry.uncompressedSize ?? entry.compressedSize) || 0;
      return {
        path,
        name,
        size,
        analyzed: Boolean(entry.analyzed) || path === archive.analyzedEntry,
      };
    })
    .filter((entry) => entry.size > 0)
    .sort((left, right) => right.size - left.size || left.name.localeCompare(right.name));
}

function renderArchivePieChart(entries, totalSize) {
  let startAngle = 0;
  const segments = [];

  entries.forEach((entry, index) => {
    const percentValue = (entry.size / totalSize) * 100;
    const endAngle = index === entries.length - 1
      ? 360
      : startAngle + (entry.size / totalSize) * 360;
    const sliceAngle = endAngle - startAngle;
    const color = getArchiveChartColor(index);
    const percent = formatPercent(entry.size, totalSize);
    const size = formatBytes(entry.size);
    const angle = midAngle(startAngle, endAngle);
    const lift = getArchiveSegmentLift(angle);
    const label = renderArchivePieLabel(percent, percentValue, angle);
    const ariaLabel = `${entry.name}, ${size}, ${percent}`;

    segments.push([
      `<g class="archive-chart-segment" tabindex="0" aria-label="${escapeAttr(ariaLabel)}" data-archive-name="${escapeAttr(entry.name)}" data-archive-size="${escapeAttr(size)}" data-archive-percent="${escapeAttr(percent)}" data-archive-color="${escapeAttr(color)}" style="--archive-lift-x: ${formatSvgNumber(lift.x)}px; --archive-lift-y: ${formatSvgNumber(lift.y)}px;">`,
      `<path class="archive-chart-slice" d="${escapeAttr(describePieSlice(startAngle, endAngle))}" fill="${escapeAttr(color)}"></path>`,
      label,
      `</g>`,
    ].join(""));

    startAngle = endAngle;
  });

  return [
    `<svg class="archive-chart-pie" viewBox="0 0 120 120" role="img" aria-label="${escapeAttr(t("archiveDistributionTitle"))}">`,
    `<g class="archive-chart-slices">`,
    segments.join(""),
    `</g>`,
    `</svg>`,
  ].join("");
}

function renderArchivePieLabel(percent, percentValue, angle) {
  const fontSize = getArchiveLabelFontSize(percentValue);
  const radius = getArchiveLabelRadius(percentValue);
  if (percentValue < ARCHIVE_CHART_LABEL_MIN_PERCENT) {
    return "";
  }

  const labelPoint = polarToCartesian(angle, radius);
  return `<text class="archive-chart-label" x="${formatSvgNumber(labelPoint.x)}" y="${formatSvgNumber(labelPoint.y)}" font-size="${formatSvgNumber(fontSize)}" aria-hidden="true">${escapeHtml(percent)}</text>`;
}

function getArchiveLabelFontSize(percentValue) {
  if (percentValue >= 50) {
    return 12;
  }
  if (percentValue >= 25) {
    return 9.5;
  }
  if (percentValue >= 12) {
    return 7.2;
  }
  return 5.8;
}

function getArchiveLabelRadius(percentValue) {
  if (percentValue >= 55) {
    return 25;
  }
  if (percentValue >= 30) {
    return 34;
  }
  if (percentValue >= 12) {
    return 38;
  }
  return 42;
}

function getArchiveSegmentLift(angleDegrees) {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: ARCHIVE_CHART_SEGMENT_LIFT * Math.cos(radians),
    y: ARCHIVE_CHART_SEGMENT_LIFT * Math.sin(radians),
  };
}

function describePieSlice(startAngle, endAngle) {
  const start = polarToCartesian(startAngle, ARCHIVE_CHART_RADIUS);
  const end = polarToCartesian(endAngle, ARCHIVE_CHART_RADIUS);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${ARCHIVE_CHART_CENTER} ${ARCHIVE_CHART_CENTER}`,
    `L ${formatSvgNumber(start.x)} ${formatSvgNumber(start.y)}`,
    `A ${ARCHIVE_CHART_RADIUS} ${ARCHIVE_CHART_RADIUS} 0 ${largeArcFlag} 1 ${formatSvgNumber(end.x)} ${formatSvgNumber(end.y)}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(angleDegrees, radius) {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: ARCHIVE_CHART_CENTER + radius * Math.cos(radians),
    y: ARCHIVE_CHART_CENTER + radius * Math.sin(radians),
  };
}

function midAngle(startAngle, endAngle) {
  return startAngle + (endAngle - startAngle) / 2;
}

function getArchiveChartColor(index) {
  return ARCHIVE_CHART_COLORS[index % ARCHIVE_CHART_COLORS.length];
}

function getFileNameFromPath(path) {
  const value = String(path || "");
  let end = value.length - 1;
  while (end >= 0 && isPathSeparator(value.charCodeAt(end))) {
    end -= 1;
  }
  if (end < 0) {
    return "";
  }

  let start = end;
  while (start >= 0 && !isPathSeparator(value.charCodeAt(start))) {
    start -= 1;
  }

  return value.slice(start + 1, end + 1);
}

function isPathSeparator(charCode) {
  return charCode === 47 || charCode === 92;
}

function formatPercent(size, totalSize) {
  if (totalSize <= 0) {
    return "0%";
  }

  const percent = (size / totalSize) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatSvgNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/u, "");
}

function renderSummaryTab(report) {
  const info = report.apkInfo;
  const stats = getStats(info);
  const featureHtml = renderFeaturePills(info.buildFeatures);

  return sectionStack([
    `<section class="summary-grid">`,
    metric(t("permissions"), stats.permissions),
    metric(t("nativeLibraries"), stats.nativeLibraries),
    metric(t("components"), stats.components),
    metric(t("signatures"), stats.signatures),
    metric(t("metaData"), stats.metaData),
    `</section>`,
    section(t("summary"), renderKeyValueTable([
      [t("appName"), info.appName],
      [t("packageName"), info.packageName],
      [t("versionName"), info.versionName],
      [t("versionCode"), info.versionCode],
      [t("targetSdk"), info.targetSdk],
      [t("minSdk"), info.minSdk],
      [t("compileSdk"), info.compileSdk],
      [t("fileName"), report.fileName],
      [t("fileSize"), formatBytes(report.fileSizeBytes)],
      [t("analyzedAt"), formatDate(report.analyzedAt)],
      [t("duration"), t("completedIn", { seconds: (report.durationMs / 1000).toFixed(2) })],
      [t("terminalSystem"), formatTerminalSystem(report)],
    ])),
    section(t("buildFeatures"), featureHtml || emptyList(t("noBuildFeatures"))),
    section(t("sdk"), renderSdkSummaryPreview(info.sdkSummary)),
  ]);
}

function renderSdkTab(report) {
  const summary = report.apkInfo.sdkSummary || {};
  return sectionStack([
    section(t("sdkNative"), renderSdkRows(summary.native || [])),
    section(t("sdkComponents"), renderSdkRows(summary.components || [])),
  ]);
}

function renderNativeTab(report) {
  const libraries = report.apkInfo.nativeLibraries || [];
  if (libraries.length === 0) {
    return emptyList(t("noNativeLibraries"));
  }

  const groups = groupBy(libraries, (library) => library.abi || t("unknown"));
  const entries = [...groups.entries()];
  if (!groups.has(state.activeNativeAbi)) {
    state.activeNativeAbi = entries[0]?.[0] || "";
  }

  const abiTabs = entries.map(([abi, items]) => [
    `<button type="button" class="native-abi-tab${abi === state.activeNativeAbi ? " is-active" : ""}" data-native-abi="${escapeAttr(abi)}" role="tab" aria-selected="${abi === state.activeNativeAbi ? "true" : "false"}">`,
    `<span>${escapeHtml(abi)}</span>`,
    `<span class="native-abi-count">${escapeHtml(String(items.length))}</span>`,
    `</button>`,
  ].join("")).join("");
  const activeLibraries = groups.get(state.activeNativeAbi) || [];
  const rows = activeLibraries.map((library) => {
    const sdk = library.sdk ? renderSdkChip(library.sdk) : "";
    return [
      `<article class="list-row native-library-row">`,
      `<div class="row-title"><span>${escapeHtml(library.name || t("unknown"))}</span></div>`,
      `<div class="row-meta">${escapeHtml(t("size"))}: ${escapeHtml(formatBytes(library.size || 0))}</div>`,
      sdk ? `<div class="row-meta native-library-sdk">${sdk}</div>` : "",
      `</article>`,
    ].join("");
  }).join("");

  return [
    `<div class="native-abi-tabs" role="tablist" aria-label="${escapeAttr(t("abi"))}">`,
    abiTabs,
    `</div>`,
    `<div class="list-stack native-library-list">${rows}</div>`,
  ].join("");
}

function renderAppTitle(title) {
  const value = title || t("unknown");
  return [
    `<h2 class="app-title-mask" data-app-title-mask>`,
    `<span class="app-title-mask__base">${escapeHtml(value)}</span>`,
    `<span class="app-title-mask__color" aria-hidden="true">${escapeHtml(value)}</span>`,
    `</h2>`,
  ].join("");
}

function renderComponentsTab(report) {
  const components = report.apkInfo.components || {};
  const total = countComponents(components);
  if (total === 0) {
    return emptyList(t("noComponents"));
  }

  const blocks = COMPONENT_SECTIONS.map((sectionName) => {
    const items = components[sectionName] || [];
    const rows = items.map(renderComponentRow).join("");
    return [
      `<details class="group-block component-group-block" open>`,
      `<summary class="component-group-summary">`,
      `<span class="component-group-title">${escapeHtml(t(sectionName))}</span>`,
      `<span class="component-group-count">${escapeHtml(String(items.length))}</span>`,
      `</summary>`,
      rows ? `<div class="list-stack component-list-stack">${rows}</div>` : emptyList(t("noComponents")),
      `</details>`,
    ].join("");
  }).join("");

  return `<div class="group-grid component-group-grid">${blocks}</div>`;
}

function renderComponentRow(component) {
  return [
    `<article class="list-row component-row">`,
    `<div class="component-row-header">`,
    `<div class="component-row-main">`,
    `<div class="row-title component-row-title"><span>${escapeHtml(component.name || t("unknown"))}</span></div>`,
    `</div>`,
    `</div>`,
    renderComponentDetails(component),
    `</article>`,
  ].join("");
}

function renderComponentDetails(component) {
  let rows = "";

  if (component.sdk) {
    rows += renderComponentDetailRow(t("detectedRule"), renderSdkInline(component.sdk));
  }
  if (component.permission) {
    rows += renderComponentDetailRow(t("permission"), inlineCodeValue(component.permission));
  }
  if (component.process) {
    rows += renderComponentDetailRow(t("process"), inlineCodeValue(component.process));
  }
  if (component.authorities) {
    rows += renderComponentDetailRow(t("authorities"), inlineCodeValue(component.authorities));
  }
  if (component.targetActivity) {
    rows += renderComponentDetailRow(t("targetActivity"), inlineCodeValue(component.targetActivity));
  }
  if (component.actions?.length) {
    rows += renderComponentDetailRow(t("actions"), inlineCodeValue(component.actions.join(", ")));
  }

  return rows
    ? `<div class="kv-table component-detail-table divider-kv-table">${rows}</div>`
    : "";
}

function renderComponentDetailRow(label, value) {
  return [
    `<div class="kv-row">`,
    `<div class="kv-label">${escapeHtml(label)}</div>`,
    `<div class="kv-value">${value || escapeHtml(t("unknown"))}</div>`,
    `</div>`,
  ].join("");
}

function renderPermissionsTab(report) {
  const permissions = [...(report.apkInfo.permissions || [])]
    .sort((left, right) => String(left || "").localeCompare(String(right || ""), "en", { sensitivity: "base" }));
  if (permissions.length === 0) {
    return emptyList(t("noPermissions"));
  }

  const rows = permissions.map((permission) => [
    `<div class="kv-row permission-table-row">`,
    `<div class="kv-value permission-table-value">${inlineCodeValue(permission)}</div>`,
    `</div>`,
  ].join("")).join("");

  return `<div class="kv-table permission-table">${rows}</div>`;
}

function renderSignaturesTab(report) {
  const signatures = report.apkInfo.signatures || {};
  const certificates = signatures.certificates || [];
  if (certificates.length === 0 && !(signatures.schemes || []).length) {
    return emptyList(t("noSignatures"));
  }

  const sections = [
    section(t("signatureSchemes"), renderSignatureSchemePills(signatures.schemes || [])),
  ];

  certificates.forEach((certificate, index) => {
    sections.push(section(
      t("signatureCertificate", { index: index + 1 }),
      renderSignatureCertificate(certificate),
    ));
  });

  return sectionStack(sections);
}

function renderSignatureSchemePills(schemes) {
  if (!schemes.length) {
    return emptyList(t("unknown"));
  }

  return `<div class="chip-cloud">${schemes.map(codeChip).join("")}</div>`;
}

function renderSignatureCertificate(certificate) {
  const publicKey = certificate.publicKey || {};
  const signatureAlgorithm = certificate.signatureAlgorithm || {};
  const fingerprints = certificate.fingerprints || {};
  const validity = certificate.validity || {};
  const rows = [
    [t("signatureSchemes"), renderSignatureListValue(certificate.schemes || [])],
    [t("signatureVersion"), escapeHtml(certificate.version || t("unknown"))],
    [t("signatureSerialNumber"), renderSignatureSerialNumber(certificate.serialNumber)],
    [t("signatureIssuer"), renderSignatureCodeValue(certificate.issuer)],
    [t("signatureSubject"), renderSignatureCodeValue(certificate.subject)],
    [t("signatureValidFrom"), escapeHtml(formatSignatureDate(validity.notBefore))],
    [t("signatureValidTo"), escapeHtml(formatSignatureDate(validity.notAfter))],
    [t("signaturePublicKeyFormat"), escapeHtml(publicKey.format || t("unknown"))],
    [t("signaturePublicKeyAlgorithm"), escapeHtml(publicKey.algorithm || t("unknown"))],
    [t("signaturePublicKeyExponent"), renderSignatureInteger(publicKey.exponent)],
    [t("signaturePublicKeyModulusSize"), publicKey.modulusSizeBits ? escapeHtml(`${publicKey.modulusSizeBits} bits`) : ""],
    [t("signaturePublicKeyModulus"), renderSignatureModulus(publicKey.modulusHex)],
    [t("signaturePublicKeyY"), renderSignatureCodeValue(publicKey.y)],
    [t("signaturePublicKeyType"), escapeHtml(publicKey.type || "")],
    [t("signatureAlgorithmName"), escapeHtml(signatureAlgorithm.name || t("unknown"))],
    [t("signatureAlgorithmOid"), renderSignatureCodeValue(signatureAlgorithm.oid)],
    [t("signatureMd5"), renderSignatureCodeValue(fingerprints.md5)],
    [t("signatureSha1"), renderSignatureCodeValue(fingerprints.sha1)],
    [t("signatureSha256"), renderSignatureCodeValue(fingerprints.sha256)],
    [t("signatureCharString"), renderSignatureCodeValue(certificate.charString)],
    [t("signatureSourceEntry"), renderSignatureListValue(certificate.sourceEntries || [])],
    [t("signatureDerLength"), certificate.derLength ? escapeHtml(formatBytes(certificate.derLength)) : ""],
  ].filter(([, value]) => String(value || "").length > 0);

  return renderHtmlKeyValueTable(rows);
}

function renderSignatureSerialNumber(serialNumber) {
  if (!serialNumber) {
    return escapeHtml(t("unknown"));
  }

  return renderSignatureCodeValue(`${serialNumber.decimal || t("unknown")} (${serialNumber.hex || t("unknown")})`);
}

function renderSignatureInteger(value) {
  if (!value) {
    return "";
  }

  return renderSignatureCodeValue(`${value.decimal || t("unknown")} (${value.hex || t("unknown")})`);
}

function renderSignatureCodeValue(value) {
  if (!value) {
    return "";
  }

  return `<code class="signature-code-value">${escapeHtml(value)}</code>`;
}

function renderSignatureModulus(value) {
  if (!value) {
    return "";
  }

  return `<code class="signature-code-value signature-modulus">${escapeHtml(formatSignatureHexBlock(value))}</code>`;
}

function renderSignatureListValue(values) {
  if (!values.length) {
    return "";
  }

  return escapeHtml(values.join(", "));
}

function formatSignatureHexBlock(value) {
  const bytes = String(value || "")
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  if (bytes.length <= 1) {
    return String(value || "");
  }

  const lines = [];
  for (let index = 0; index < bytes.length; index += 16) {
    lines.push(bytes.slice(index, index + 16).join(":"));
  }

  return lines.join("\n");
}

function renderMetaDataTab(report) {
  const metaData = report.apkInfo.metaData?.application || [];
  if (metaData.length === 0) {
    return emptyList(t("noMetaData"));
  }

  const rows = metaData.map((item) => [
    `<article class="list-row">`,
    `<div class="row-title"><span>${escapeHtml(item.name || t("unknown"))}</span></div>`,
    `<div class="row-meta">${renderMetaDataValue(item)}</div>`,
    item.resourceId != null ? `<div class="row-meta">${escapeHtml(t("resource"))}: ${codeChip(formatResourceId(item.resourceId))}</div>` : "",
    `</article>`,
  ].join("")).join("");

  return `<div class="list-stack">${rows}</div>`;
}

function renderMetaDataValue(item) {
  const value = escapeHtml(item.value || t("unknown"));
  if (!item.hasResourceReference) {
    return value;
  }

  return `${escapeHtml(t("value"))}${state.locale.startsWith("zh") ? "：" : ": "}${value}`;
}

function renderRawTab(report) {
  return [
    `<div class="raw-toolbar">`,
    `<p class="warning-note">${escapeHtml(t("rawNotice"))}</p>`,
    `<button class="secondary-button raw-export-button" type="button" data-json-export>`,
    `<svg viewBox="0 0 24 24" aria-hidden="true">`,
    `<path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.29a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1ZM5 18a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"></path>`,
    `</svg>`,
    `<span>${escapeHtml(t("exportJson"))}</span>`,
    `</button>`,
    `</div>`,
    `<pre class="json-block">${escapeHtml(formatExportJson(report))}</pre>`,
  ].join("");
}

function renderSdkSummaryPreview(sdkSummary) {
  if (!sdkSummary) {
    return emptyList(t("noSdkMarkers"));
  }

  const combined = [];
  appendSdkSummaryEntries(combined, sdkSummary.native, t("nativeLibraries"));
  appendSdkSummaryEntries(combined, sdkSummary.components, t("components"));
  combined.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  if (combined.length === 0) {
    return emptyList(t("noSdkMarkers"));
  }

  return renderSdkRows(combined.slice(0, 8));
}

function appendSdkSummaryEntries(target, entries = [], source) {
  for (const entry of entries || []) {
    target.push({
      ...entry,
      source,
    });
  }
}

function renderSdkRows(entries) {
  if (!entries.length) {
    return emptyList(t("noSdkMarkers"));
  }

  let max = 1;
  for (const entry of entries) {
    max = Math.max(max, entry.count || 0);
  }

  const rows = entries.map((entry) => {
    const width = Math.max(4, Math.round(((entry.count || 0) / max) * 100));
    const preview = renderCodeChipList(entry.previewItems || []);
    const detail = joinTextParts([entry.source, entry.detail]);
    return [
      `<article class="sdk-row">`,
      `<div class="sdk-row-header">`,
      `<div class="sdk-title">${renderSdkIcon(entry.iconUrl, entry.label, entry.singleColorIcon)}${renderSdkRuleLabel(entry, t("unknown"))}</div>`,
      `<span class="sdk-count">${escapeHtml(String(entry.count || 0))}</span>`,
      `</div>`,
      `<div class="bar-track"><div class="bar" style="width: ${width}%"></div></div>`,
      detail ? `<div class="sdk-meta">${escapeHtml(detail)}</div>` : "",
      preview ? `<div class="sdk-preview">${preview}</div>` : "",
      `</article>`,
    ].join("");
  }).join("");

  return `<div class="sdk-stack">${rows}</div>`;
}

function renderCodeChipList(items) {
  let html = "";
  for (const item of items) {
    html += codeChip(item);
  }
  return html;
}

function joinTextParts(parts) {
  const values = [];
  for (const part of parts) {
    if (part) {
      values.push(part);
    }
  }
  return values.join(" · ");
}

function renderFeaturePills(buildFeatures = {}) {
  const features = [];
  if (buildFeatures.kotlinDetected) {
    features.push(buildFeatureLabel("Kotlin", buildFeatures.kotlinVersion));
  }
  if (buildFeatures.composeDetected) {
    features.push(buildFeatureLabel("Compose", buildFeatures.composeVersion));
  }
  if (buildFeatures.gradleVersion) {
    features.push(`Gradle ${buildFeatures.gradleVersion}`);
  }
  if (buildFeatures.agpVersion) {
    features.push(`AGP ${buildFeatures.agpVersion}`);
  }
  if (buildFeatures.appMetadataVersion) {
    features.push(`App Metadata ${buildFeatures.appMetadataVersion}`);
  }

  if (!features.length) {
    return "";
  }

  return `<div class="feature-grid">${features.map((item) => `<span class="feature-pill">${escapeHtml(item)}</span>`).join("")}</div>`;
}

function renderSdkChip(sdk) {
  return renderSdkChipBase(sdk, t("unknown"));
}

function renderSdkInline(sdk) {
  return renderSdkInlineBase(sdk, t("unknown"));
}

function renderAppIcon(info) {
  const src = sanitizeImageSrc(info.icon?.dataUri || "");
  if (src) {
    return `<img class="app-icon" src="${escapeAttr(src)}" alt="${escapeAttr(info.appName || t("appName"))}">`;
  }

  return `<div class="app-icon-placeholder" aria-hidden="true">${escapeHtml(getInitial(info.appName || info.packageName))}</div>`;
}


function renderKeyValueTable(rows) {
  return [
    `<div class="kv-table divider-kv-table summary-kv-table">`,
    rows.map(([label, value]) => [
      `<div class="kv-row">`,
      `<div class="kv-label">${escapeHtml(label)}</div>`,
      `<div class="kv-value">${escapeHtml(value || t("unknown"))}</div>`,
      `</div>`,
    ].join("")).join(""),
    `</div>`,
  ].join("");
}

function renderHtmlKeyValueTable(rows, className = "") {
  const classes = ["kv-table", className].filter(Boolean).join(" ");
  return [
    `<div class="${escapeAttr(classes)}">`,
    rows.map(([label, value]) => [
      `<div class="kv-row">`,
      `<div class="kv-label">${escapeHtml(label)}</div>`,
      `<div class="kv-value">${value || escapeHtml(t("unknown"))}</div>`,
      `</div>`,
    ].join("")).join(""),
    `</div>`,
  ].join("");
}

function metric(label, value) {
  return [
    `<article class="metric-card">`,
    `<div class="metric-label">${escapeHtml(label)}</div>`,
    `<div class="metric-value">${escapeHtml(String(value))}</div>`,
    `</article>`,
  ].join("");
}

function section(title, body) {
  return `<section class="section-band"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function sectionStack(items) {
  return `<div class="section-stack">${items.join("")}</div>`;
}

function chip(value) {
  return `<span class="chip">${escapeHtml(value || t("unknown"))}</span>`;
}

function codeChip(value) {
  return `<span class="code-chip">${escapeHtml(value || t("unknown"))}</span>`;
}

function inlineCodeValue(value) {
  return `<code class="inline-code-value">${escapeHtml(value || t("unknown"))}</code>`;
}

function emptyList(message) {
  return `<p class="empty-list">${escapeHtml(message)}</p>`;
}


function buildFeatureLabel(name, version) {
  return version ? `${name} ${version}` : name;
}

function isLikelyApk(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return (
    [".apk", ".apks", ".apkm", ".xapk"].some((extension) => name.endsWith(extension)) ||
    type.includes("android.package-archive")
  );
}

function downloadReport(report, json = "") {
  trackWebEvent("webui.report.exported", {
    result: "success",
    operation: "json_export",
    ...getReportAnalyticsFields(report),
  });

  const data = json || formatExportJson(report);
  const blob = new Blob([data], { type: "application/json;charset=UTF-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilePart(report.apkInfo?.packageName || report.fileName || "apk-report")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildExportReport(report) {
  return stripDataUris({
    ...report,
    apkInfo: {
      ...report.apkInfo,
    },
  });
}

function formatExportJson(report) {
  if (!report || typeof report !== "object") {
    return "{}";
  }

  const cached = exportJsonCache.get(report);
  if (cached) {
    return cached;
  }

  const formatted = JSON.stringify(buildExportReport(report), null, 2);
  exportJsonCache.set(report, formatted);
  return formatted;
}




function formatDate(value) {
  if (!value) {
    return t("unknown");
  }

  try {
    return getDateTimeFormatter(state.locale).format(new Date(value));
  } catch {
    return value;
  }
}

function getDateTimeFormatter(locale) {
  const key = normalizeLocale(locale);
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(key, {
      dateStyle: "medium",
      timeStyle: "medium",
    });
    dateTimeFormatters.set(key, formatter);
  }

  return formatter;
}

function formatSignatureDate(value) {
  if (!value) {
    return t("unknown");
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return formatDate(value);
}


function formatTerminalSystem(report) {
  const system = report.terminalSystem || report.analysisProfile?.runtime?.system || {};
  const name = String(system.name || "").trim();
  const version = String(system.version || "").trim();

  if (!name && !version) {
    return t("unknown");
  }

  return [name, version].filter(Boolean).join(" ");
}
