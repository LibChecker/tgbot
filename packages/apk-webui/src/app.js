import { escapeAttr, escapeHtml } from "./app/html.js";
import { getSupportedLocales, normalizeLocale, resolvePreferredLocale, translate } from "./app/i18n.js";
import { clamp } from "./app/math.js";
import { formatBytes, getInitial, sanitizeImageSrc } from "./app/format.js";
import { getStats } from "./app/report-model.js";
import {
  buildHistorySummary,
  createHistoryEntry,
  persistHistory,
  persistHistoryCollapsed,
  persistHistoryViewMode,
  readHistory,
  readHistoryCollapsed,
  readHistoryViewMode,
} from "./app/history.js";
import { getFileAnalyticsFields, getReportAnalyticsFields } from "./app/analytics-fields.js";
import {
  ANALYTICS_EVENT_QUEUE_LIMIT,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  VALID_APP_MODES,
  VALID_TABS,
  WORKER_IDLE_TERMINATE_MS,
  createAppState,
  createHistoryViewDragState,
  createModeDragState,
  createReportTabDragState,
  createRuntimeState,
  createThemeDragState,
  dateTimeFormatters,
  pendingAnalyticsEvents,
  pointerCoordinateUpdaters,
} from "./app/state.js";
import { renderBrandTitle } from "./app/title-effects.js";
import {
  collectAppElements,
  hideAnalyzeReportViews,
  setTabPanelHtml,
  showEmptyReportState,
  showReportState,
  updateTabButtons as updateTabButtonsView,
} from "./app/view.js";
import { isAnalyzerWorkerMessage } from "@shared/contracts.js";

/** @typedef {import("@shared/contracts.js").AnalyticsEventFields} AnalyticsEventFields */
/** @typedef {import("@shared/contracts.js").AnalyzerWorkerResponse} AnalyzerWorkerResponse */

const LIQUID_GLASS_FILTER_ID = "apk-rule-preview-liquid-glass-refraction";
const LIQUID_GLASS_FILTER_MAP_ID = `${LIQUID_GLASS_FILTER_ID}-map`;
const LIQUID_GLASS_DISPLACEMENT_ID = `${LIQUID_GLASS_FILTER_ID}-displacement`;
const LIQUID_GLASS_RED_DISPLACEMENT_ID = `${LIQUID_GLASS_FILTER_ID}-red-displacement`;
const LIQUID_GLASS_BLUE_DISPLACEMENT_ID = `${LIQUID_GLASS_FILTER_ID}-blue-displacement`;
const LIQUID_GLASS_PREVIEW_SELECTOR = ".sdk-rule-preview, .sdk-icon-preview, .lcapps-picker__panel, .lcapps-bubble";
const LIQUID_GLASS_CHANNEL_GAIN = 6;
const ANALYTICS_IDLE_LOAD_DELAY_MS = 4000;
const ANALYTICS_IDLE_LOAD_TIMEOUT_MS = 6000;
const BRAND_TITLE_IDLE_LOAD_DELAY_MS = 3200;
const BRAND_TITLE_IDLE_LOAD_TIMEOUT_MS = 5000;
const HISTORY_SAVE_IDLE_TIMEOUT_MS = 1600;
const URL_REPORT_ENDPOINT = "/url-report";
const URL_REPORT_PROGRESS_KEYS = Object.freeze({
  accepted: "progressPreparingLink",
  url_preview: "progressPreparingLink",
  url_parse: "progressPreparingLink",
  remote_metadata: "progressRemoteMetadata",
  zip_tail: "progressZipTail",
  central_directory: "progressCentralDirectory",
  apk_metadata: "progressApkMetadata",
  sdk_annotation: "progressSdkAnnotation",
  report_build: "progressReportBuild",
});
const PROGRESS_WIDTH_TRANSITION = "width 180ms ease";
const APP_VERSION = typeof __APK_WEBUI_VERSION__ === "string" ? __APK_WEBUI_VERSION__ : "dev";
const RUNTIME_LOG_EXPORT_TITLE = "LibChecker WebUI Runtime Logs";
const MAX_RUNTIME_LOGS = 200;
const RUNTIME_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const RUNTIME_LOG_DETAIL_KEYS = new Set([
  "archive_type",
  "body_bytes",
  "client_duration_ms",
  "apk_entry_count",
  "component_count",
  "downloaded_bytes",
  "duration_ms",
  "error_code",
  "error_message",
  "error_name",
  "file_extension",
  "file_kind",
  "has_app_icon",
  "http_status",
  "history_count",
  "input_source",
  "fetch_headers_ms",
  "json_parse_ms",
  "locale",
  "meta_data_count",
  "native_library_count",
  "operation",
  "permissions_count",
  "range_request_count",
  "range_cache_hit_count",
  "render_ms",
  "response_text_ms",
  "remote_package_type",
  "result",
  "sdk_component_match_count",
  "sdk_native_match_count",
  "selected_apk_compression",
  "selected_apk_entry",
  "server_duration_ms",
  "size_bucket",
  "slot",
  "terminal_detect_ms",
  "top_level_zip_entry_count",
  "value",
  "version",
]);
const BRAND_LOGO_FOREGROUND_PATH = [
  "M139.391 222.718H129.667C125.942 222.566 123 219.502 123 215.773C123 212.045 125.942 208.98 129.667 208.828H139.391V194.942H129.667C125.942 194.79 123 191.726 123 187.997C123 184.268 125.942 181.204 129.667 181.052H139.391V167.166",
  "H129.667C125.942 167.014 123 163.95 123 160.221C123 156.492 125.942 153.428 129.667 153.276L139.391 153.277V150.499",
  "C139.39 147.552 140.559 144.726 142.643 142.643C144.726 140.56 147.552 139.39 150.498 139.391H153.277V129.668C153.429 125.942 156.493 123 160.222 123C163.951 123 167.015 125.942 167.167 129.668V139.39",
  "L181.053 139.391V129.668C181.205 125.942 184.269 123 187.998 123C191.726 123 194.791 125.942 194.943 129.668V139.391",
  "H208.829V129.668C208.981 125.942 212.045 123 215.774 123C219.502 123 222.567 125.942 222.719 129.668L222.717 139.39",
  "H225.496C228.443 139.388 231.269 140.558 233.354 142.641C235.438 144.724 236.609 147.55 236.609 150.497V153.276",
  "H246.333C250.058 153.428 253 156.492 253 160.221C253 163.95 250.058 167.014 246.333 167.166H236.609V181.052",
  "H246.333C250.058 181.204 253 184.268 253 187.997C253 191.726 250.058 194.79 246.333 194.942H236.609V208.827",
  "H246.333C250.058 208.979 253 212.043 253 215.772C253 219.501 250.058 222.565 246.333 222.717H236.609V225.496",
  "C236.609 231.633 231.633 236.609 225.496 236.609H222.717V246.332C222.565 250.058 219.501 253 215.772 253C212.044 253 208.979 250.058 208.827 246.332V236.609",
  "H194.941V246.332C194.789 250.058 191.725 253 187.996 253C184.268 253 181.203 250.058 181.051 246.332V236.609",
  "H167.166V246.332C167.014 250.058 163.949 253 160.22 253C156.492 253 153.427 250.058 153.275 246.332L153.277 236.61",
  "H150.498C144.361 236.61 139.391 231.635 139.391 225.497V222.718Z",
  "M202.723 167.162H173.277C169.886 167.162 167.167 169.887 167.167 173.272V202.718C167.163 204.34 167.805 205.896 168.952 207.043C170.099 208.19 171.655 208.832 173.277 208.828H202.723C206.113 208.828 208.833 206.103 208.833 202.718V173.272C208.833 169.881 206.108 167.162 202.723 167.162Z",
].join(" ");
const SEGMENT_DRAG_START_THRESHOLD_PX = 4;
const SEGMENT_TOUCH_DRAG_START_THRESHOLD_PX = 16;
const TOPBAR_SEGMENT_SCROLL_START_THRESHOLD_PX = 12;
const TOPBAR_SCROLL_EPSILON_PX = 1;
const LIQUID_GLASS_CONTROLS = Object.freeze({
  edgeIntensity: 0.01,
  rimIntensity: 0.05,
  baseIntensity: 0.01,
  edgeDistance: 0.15,
  rimDistance: 0.8,
  baseDistance: 0.1,
  cornerBoost: 0.02,
  rippleEffect: 0.1,
  blurRadius: 5,
  tintOpacity: 0.2,
  warp: false,
});
const LCAPPS_BUBBLE_BOUNCE_MS = 1040;
const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const fineHoverMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
const mobileTopbarMedia = window.matchMedia("(max-width: 700px)");
const POINTER_SPOTLIGHT_MIN_ALPHA = 0.16;
const POINTER_SPOTLIGHT_MAX_ALPHA = 0.42;
const POINTER_SPOTLIGHT_DISTANCE_FOR_MAX_ALPHA = 340;
const POINTER_SPOTLIGHT_REST_DISTANCE = 0.35;


const state = createAppState({
  locale: resolveInitialLocale(),
  themeChoice: readThemeChoice(),
  history: readHistory(),
  historyCollapsed: readHistoryCollapsed(),
  historyViewMode: readHistoryViewMode(),
});
const themeDrag = createThemeDragState();
const modeDrag = createModeDragState();
const historyViewDrag = createHistoryViewDragState();
const tabDrag = createReportTabDragState();
const runtime = createRuntimeState();
const elements = collectAppElements();

function t(key, variables = {}) {
  return translate(state.locale, key, variables);
}

function initWebAnalytics(contextProvider) {
  if (typeof contextProvider === "function") {
    runtime.analyticsContextProvider = contextProvider;
  }
  if (isAppPowerConstrained()) {
    return;
  }
  scheduleAnalyticsLoad();
}

/**
 * @param {string} event
 * @param {AnalyticsEventFields} [fields]
 */
function trackWebEvent(event, fields = {}) {
  if (!event) {
    return;
  }

  appendRuntimeLog(getRuntimeEventLevel(event, fields), event, fields);

  if (runtime.analyticsModule && runtime.analyticsInitialized) {
    runtime.analyticsModule.trackWebEvent(event, fields);
    return;
  }

  if (pendingAnalyticsEvents.length >= ANALYTICS_EVENT_QUEUE_LIMIT) {
    pendingAnalyticsEvents.shift();
  }
  pendingAnalyticsEvents.push([event, fields]);
  void loadWebAnalyticsModule().then(initializeAnalyticsModule).catch(() => {});
}

function appendRuntimeLog(level, message, details = {}) {
  const normalizedLevel = RUNTIME_LOG_LEVELS.has(level) ? level : "info";
  runtime.runtimeLogId += 1;
  state.runtimeLogs.push({
    id: runtime.runtimeLogId,
    level: normalizedLevel,
    message: String(message || ""),
    details: formatRuntimeLogDetails(details),
    time: Date.now(),
  });

  if (state.runtimeLogs.length > MAX_RUNTIME_LOGS) {
    state.runtimeLogs.splice(0, state.runtimeLogs.length - MAX_RUNTIME_LOGS);
  }

  if (state.runtimeLogOpen) {
    renderRuntimeLogs();
  }
}

function getRuntimeEventLevel(event, fields = {}) {
  const result = String(fields?.result || "");
  if (result === "error" || result === "worker_error" || event.includes(".failed") || event.includes("_failed")) {
    return "error";
  }
  if (result === "invalid_url" || result === "worker_unavailable" || result === "collapsed") {
    return "warn";
  }
  if (result === "cancelled") {
    return "debug";
  }
  if (event.includes(".changed") || event.includes(".toggled") || event.includes(".viewed")) {
    return "debug";
  }
  return "info";
}

function formatRuntimeLogDetails(details = {}) {
  if (!details || typeof details !== "object") {
    return "";
  }

  const pairs = [];
  for (const [key, value] of Object.entries(details)) {
    if (!RUNTIME_LOG_DETAIL_KEYS.has(key)) {
      continue;
    }
    if (value == null || value === "") {
      continue;
    }
    if (typeof value === "object" || typeof value === "function") {
      continue;
    }
    const text = String(value);
    pairs.push(`${key}=${text.length > 80 ? `${text.slice(0, 77)}...` : text}`);
    if (pairs.length >= 12) {
      break;
    }
  }

  return pairs.join("; ");
}

function scheduleAnalyticsLoad() {
  if (
    isAppPowerConstrained() ||
    runtime.analyticsModule ||
    runtime.analyticsModulePromise ||
    runtime.analyticsLoadScheduled
  ) {
    return;
  }

  runtime.analyticsLoadScheduled = true;
  const load = () => {
    runtime.analyticsLoadScheduled = false;
    void loadWebAnalyticsModule().then(initializeAnalyticsModule).catch(() => {});
  };

  if (typeof window.requestIdleCallback === "function") {
    window.setTimeout(() => {
      window.requestIdleCallback(load, { timeout: ANALYTICS_IDLE_LOAD_TIMEOUT_MS });
    }, ANALYTICS_IDLE_LOAD_DELAY_MS);
  } else {
    window.setTimeout(load, ANALYTICS_IDLE_LOAD_DELAY_MS);
  }
}

function loadWebAnalyticsModule() {
  if (runtime.analyticsModule) {
    return Promise.resolve(runtime.analyticsModule);
  }

  if (!runtime.analyticsModulePromise) {
    runtime.analyticsModulePromise = import("./app/analytics.js")
      .then((module) => {
        runtime.analyticsModule = module;
        return module;
      })
      .catch((error) => {
        runtime.analyticsModulePromise = null;
        throw error;
      });
  }

  return runtime.analyticsModulePromise;
}

function initBrandTitleColorMaskWhenIdle(node) {
  if (!node || isAppPowerConstrained()) {
    return;
  }

  let initialized = false;
  const pointerOptions = { passive: true };
  const init = () => {
    if (initialized || isAppPowerConstrained()) {
      return;
    }

    initialized = true;
    node.removeEventListener("pointerenter", init, pointerOptions);
    node.removeEventListener("pointermove", init, pointerOptions);

    void loadBrandTitleColorMask().then((initBrandTitleColorMask) => {
      if (node.isConnected) {
        initBrandTitleColorMask(node);
      }
    }).catch(() => {});
  };

  node.addEventListener("pointerenter", init, pointerOptions);
  node.addEventListener("pointermove", init, pointerOptions);

  if (typeof window.requestIdleCallback === "function") {
    window.setTimeout(() => {
      window.requestIdleCallback(init, { timeout: BRAND_TITLE_IDLE_LOAD_TIMEOUT_MS });
    }, BRAND_TITLE_IDLE_LOAD_DELAY_MS);
  } else {
    window.setTimeout(init, BRAND_TITLE_IDLE_LOAD_DELAY_MS);
  }
}

function loadBrandTitleColorMask() {
  if (!runtime.brandTitleColorMaskPromise) {
    runtime.brandTitleColorMaskPromise = import("./app/brand-title-mask.js")
      .then(({ initBrandTitleColorMask }) => initBrandTitleColorMask)
      .catch((error) => {
        runtime.brandTitleColorMaskPromise = null;
        throw error;
      });
  }

  return runtime.brandTitleColorMaskPromise;
}

function initializeAnalyticsModule(module) {
  if (!runtime.analyticsInitialized) {
    module.initWebAnalytics(runtime.analyticsContextProvider);
    runtime.analyticsInitialized = true;
  }

  flushPendingAnalyticsEvents(module);
}

function flushPendingAnalyticsEvents(module) {
  while (pendingAnalyticsEvents.length) {
    const [event, fields] = pendingAnalyticsEvents.shift();
    module.trackWebEvent(event, fields);
  }
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
  if (runtime.compareController) {
    return Promise.resolve(runtime.compareController);
  }

  if (!runtime.compareControllerPromise) {
    runtime.compareControllerPromise = import("./app/compare-controller.js")
      .then(({ CompareController }) => {
        runtime.compareController = createCompareController(CompareController);
        runtime.compareController.bindEvents();
        preloadReportPreviewInteractions();
        runtime.compareController.setVisible(state.appMode === "compare");
        updateClearButton();
        return runtime.compareController;
      })
      .catch((error) => {
        runtime.compareControllerPromise = null;
        handleCompareControllerLoadError(error);
        return null;
      });
  }

  return runtime.compareControllerPromise;
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

function loadLcappsReaderModule() {
  if (!runtime.lcappsReaderModulePromise) {
    runtime.lcappsReaderModulePromise = import("./app/lcapps-reader.js")
      .catch((error) => {
        runtime.lcappsReaderModulePromise = null;
        throw error;
      });
  }

  return runtime.lcappsReaderModulePromise;
}

function loadSdkIconRendererModule() {
  if (runtime.sdkIconRendererModule) {
    return Promise.resolve(runtime.sdkIconRendererModule);
  }

  if (!runtime.sdkIconRendererModulePromise) {
    runtime.sdkIconRendererModulePromise = import("./app/sdk-icon-renderer.js")
      .then((module) => {
        runtime.sdkIconRendererModule = module;
        return module;
      })
      .catch((error) => {
        runtime.sdkIconRendererModulePromise = null;
        throw error;
      });
  }

  return runtime.sdkIconRendererModulePromise;
}

function loadReportRendererModule() {
  if (runtime.reportRendererModule) {
    return Promise.resolve(runtime.reportRendererModule);
  }

  if (!runtime.reportRendererModulePromise) {
    runtime.reportRendererModulePromise = import("./app/report-renderer.js")
      .then((module) => {
        module.configureReportRenderer({
          runtime,
          state,
          t,
          formatDate,
          trackWebEvent,
          getReportAnalyticsFields,
        });
        runtime.reportRendererModule = module;
        return module;
      })
      .catch((error) => {
        runtime.reportRendererModulePromise = null;
        throw error;
      });
  }

  return runtime.reportRendererModulePromise;
}

function preloadReportRenderer() {
  void loadReportRendererModule().catch(() => {});
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
  if (runtime.compareController) {
    runtime.compareController.renderPage();
  } else if (state.appMode === "compare") {
    loadCompareControllerForCurrentMode();
  }
}

function renderCompareHistoryOptionsIfLoaded() {
  runtime.compareController?.renderHistoryOptions();
}

async function detectCurrentTerminalSystem() {
  if (!runtime.terminalSystemDetectorPromise) {
    runtime.terminalSystemDetectorPromise = import("./app/system.js")
      .then(({ detectTerminalSystem }) => detectTerminalSystem)
      .catch((error) => {
        runtime.terminalSystemDetectorPromise = null;
        throw error;
      });
  }

  const detectTerminalSystem = await runtime.terminalSystemDetectorPromise;
  return detectTerminalSystem();
}

function initPowerModeAdaptation() {
  if (runtime.powerModeInitialized) {
    return;
  }

  runtime.powerModeInitialized = true;
  runtime.powerModeMediaQueries = [
    createOptionalMediaQuery("(prefers-reduced-motion: reduce)"),
    createOptionalMediaQuery("(prefers-reduced-transparency: reduce)"),
    createOptionalMediaQuery("(prefers-reduced-data: reduce)"),
  ].filter(Boolean);

  for (const mediaQuery of runtime.powerModeMediaQueries) {
    addChangeListener(mediaQuery, refreshPowerMode);
  }

  const connection = getNetworkInformation();
  if (connection) {
    addChangeListener(connection, refreshPowerMode);
  }

  initBatteryPowerModeMonitoring();
  refreshPowerMode();
}

function createOptionalMediaQuery(query) {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
  } catch {
    return null;
  }
}

function addChangeListener(target, listener) {
  if (typeof target.addEventListener === "function") {
    target.addEventListener("change", listener);
    return;
  }

  if (typeof target.addListener === "function") {
    target.addListener(listener);
  }
}

function initBatteryPowerModeMonitoring() {
  if (typeof navigator.getBattery !== "function") {
    return;
  }

  void navigator.getBattery()
    .then((battery) => {
      runtime.powerModeBattery = battery;
      addChangeListener(battery, refreshPowerMode);
      battery.addEventListener?.("chargingchange", refreshPowerMode);
      battery.addEventListener?.("levelchange", refreshPowerMode);
      refreshPowerMode();
    })
    .catch(() => {});
}

function refreshPowerMode() {
  const constrained = detectPowerConstrainedMode();
  runtime.powerConstrained = constrained;
  document.documentElement.dataset.powerMode = constrained ? "constrained" : "normal";

  if (constrained) {
    disableRulePreviewMaterial();
    clearDropZonePointerState();
    clearHistoryPointerState();
    return;
  }

  if (runtime.rulePreviewMaterialCapabilitySupported) {
    enableRulePreviewMaterial();
  }
}

function detectPowerConstrainedMode() {
  return (
    hasReducedMotionPreference() ||
    hasReducedTransparencyPreference() ||
    hasReducedDataPreference() ||
    hasSaveDataPreference() ||
    hasLowBatteryPowerConstraint()
  );
}

function isAppPowerConstrained() {
  return runtime.powerConstrained;
}

function hasReducedMotionPreference() {
  return matchesMediaQuery("(prefers-reduced-motion: reduce)");
}

function hasReducedTransparencyPreference() {
  return matchesMediaQuery("(prefers-reduced-transparency: reduce)");
}

function hasReducedDataPreference() {
  return matchesMediaQuery("(prefers-reduced-data: reduce)");
}

function matchesMediaQuery(query) {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function hasSaveDataPreference() {
  return getNetworkInformation()?.saveData === true;
}

function getNetworkInformation() {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

function hasLowBatteryPowerConstraint() {
  const battery = runtime.powerModeBattery;
  return Boolean(battery && battery.charging === false && battery.level <= 0.2);
}

function ensureRulePreviewMaterial() {
  if (document.documentElement.dataset.rulePreviewMaterial) {
    if (isAppPowerConstrained()) {
      disableRulePreviewMaterial();
      return;
    }

    ensureLiquidGlassFilter();
    scheduleLiquidGlassMapPrewarm();
    return;
  }

  if (runtime.rulePreviewMaterialCapabilityChecked) {
    return;
  }

  runtime.rulePreviewMaterialCapabilityChecked = true;
  void getLiquidGlassFallbackReason()
    .then((fallbackReason) => {
      runtime.rulePreviewMaterialFallbackReason = fallbackReason;
      runtime.rulePreviewMaterialCapabilitySupported = !fallbackReason;
      if (!runtime.rulePreviewMaterialCapabilitySupported || isAppPowerConstrained()) {
        setRulePreviewMaterialFallbackReason(fallbackReason);
        return;
      }

      enableRulePreviewMaterial();
    })
    .catch(() => {
      runtime.rulePreviewMaterialCapabilityChecked = false;
    });
}

function enableRulePreviewMaterial() {
  if (isAppPowerConstrained()) {
    return;
  }

  ensureLiquidGlassFilter();
  setRulePreviewMaterialFallbackReason("");
  document.documentElement.dataset.rulePreviewMaterial = "liquid-glass";
  scheduleLiquidGlassMapPrewarm();
  updateLiquidGlassFilterForActivePreview();
}

function disableRulePreviewMaterial() {
  if (document.documentElement.dataset.rulePreviewMaterial === "liquid-glass") {
    delete document.documentElement.dataset.rulePreviewMaterial;
  }

  runtime.liquidGlassFilterSignature = "";
  runtime.liquidGlassMapCache.clear();
}

function setRulePreviewMaterialFallbackReason(reason) {
  if (reason) {
    document.documentElement.dataset.rulePreviewMaterialFallback = reason;
  } else {
    delete document.documentElement.dataset.rulePreviewMaterialFallback;
  }
}

function scheduleRulePreviewMaterialWarmup() {
  if (
    runtime.rulePreviewMaterialWarmupScheduled ||
    runtime.rulePreviewMaterialCapabilityChecked ||
    document.documentElement.dataset.rulePreviewMaterial
  ) {
    return;
  }

  runtime.rulePreviewMaterialWarmupScheduled = true;
  const warmup = () => {
    runtime.rulePreviewMaterialWarmupScheduled = false;
    ensureRulePreviewMaterial();
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warmup, { timeout: 1600 });
  } else {
    window.setTimeout(warmup, 0);
  }
}

function scheduleLiquidGlassMapPrewarm() {
  if (runtime.liquidGlassMapPrewarmScheduled || isAppPowerConstrained()) {
    return;
  }

  runtime.liquidGlassMapPrewarmScheduled = true;
  const prewarm = () => {
    runtime.liquidGlassMapPrewarmScheduled = false;
    if (isAppPowerConstrained() || document.documentElement.dataset.rulePreviewMaterial !== "liquid-glass") {
      return;
    }

    getLiquidGlassRefractionMapDataUrl(96, 64, 24);
    getLiquidGlassRefractionMapDataUrl(150, 70, 12);
    getLiquidGlassRefractionMapDataUrl(190, 90, 12);
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(prewarm, { timeout: 2200 });
  } else {
    window.setTimeout(prewarm, 0);
  }
}

async function getLiquidGlassFallbackReason() {
  const { getLiquidGlassBrowserConfigFallbackReason } = await import("./app/liquid-glass-support.js");
  const browserConfigReason = getLiquidGlassBrowserConfigFallbackReason();
  if (browserConfigReason) {
    return browserConfigReason;
  }

  if (!supportsLiquidGlassCssFilters()) {
    return "css-svg-backdrop-filter";
  }

  if (!supportsLiquidGlassSvgFilters()) {
    return "svg-filter-elements";
  }

  if (!supportsLiquidGlassCanvasMap()) {
    return "canvas-filter-map";
  }

  return "";
}

function supportsLiquidGlassCssFilters() {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return false;
  }

  const filterValue = `blur(${LIQUID_GLASS_CONTROLS.blurRadius}px) url("#${LIQUID_GLASS_FILTER_ID}")`;
  return (
    CSS.supports("backdrop-filter", filterValue) ||
    CSS.supports("-webkit-backdrop-filter", filterValue)
  );
}

function supportsLiquidGlassSvgFilters() {
  if (typeof document.createElementNS !== "function" || typeof SVGElement === "undefined") {
    return false;
  }

  const namespace = "http://www.w3.org/2000/svg";
  return ["filter", "feImage", "feDisplacementMap", "feColorMatrix", "feComposite"]
    .every((tagName) => document.createElementNS(namespace, tagName) instanceof SVGElement);
}

function supportsLiquidGlassCanvasMap() {
  try {
    const canvas = document.createElement("canvas");
    return typeof canvas.toDataURL === "function" && Boolean(canvas.getContext("2d"));
  } catch {
    return false;
  }
}

function ensureLiquidGlassFilter() {
  if (document.getElementById(LIQUID_GLASS_FILTER_ID)) {
    return;
  }

  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";

  const defs = document.createElementNS(namespace, "defs");
  const filter = document.createElementNS(namespace, "filter");
  filter.id = LIQUID_GLASS_FILTER_ID;
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "100%");
  filter.setAttribute("height", "100%");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const map = document.createElementNS(namespace, "feImage");
  map.id = LIQUID_GLASS_FILTER_MAP_ID;
  map.setAttribute("x", "0");
  map.setAttribute("y", "0");
  map.setAttribute("width", "100%");
  map.setAttribute("height", "100%");
  map.setAttribute("preserveAspectRatio", "none");
  map.setAttribute("result", "liquidMap");
  setSvgHref(map, createNeutralLiquidGlassMapDataUrl());

  const redDisplacement = createLiquidGlassDisplacementNode(
    namespace,
    LIQUID_GLASS_RED_DISPLACEMENT_ID,
    "liquidRedWarp",
    "22",
  );
  const displacement = createLiquidGlassDisplacementNode(
    namespace,
    LIQUID_GLASS_DISPLACEMENT_ID,
    "liquidGreenWarp",
    "18",
  );
  const blueDisplacement = createLiquidGlassDisplacementNode(
    namespace,
    LIQUID_GLASS_BLUE_DISPLACEMENT_ID,
    "liquidBlueWarp",
    "14",
  );
  const redChannel = createLiquidGlassColorMatrixNode(
    namespace,
    "liquidRedWarp",
    "liquidRedChannel",
    "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  );
  const greenChannel = createLiquidGlassColorMatrixNode(
    namespace,
    "liquidGreenWarp",
    "liquidGreenChannel",
    "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  );
  const blueChannel = createLiquidGlassColorMatrixNode(
    namespace,
    "liquidBlueWarp",
    "liquidBlueChannel",
    "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
  );
  const redGreenComposite = createLiquidGlassCompositeNode(
    namespace,
    "liquidRedChannel",
    "liquidGreenChannel",
    "liquidRedGreen",
  );
  const glassComposite = createLiquidGlassCompositeNode(
    namespace,
    "liquidRedGreen",
    "liquidBlueChannel",
    "liquidGlassComposite",
  );

  filter.append(
    map,
    redDisplacement,
    displacement,
    blueDisplacement,
    redChannel,
    greenChannel,
    blueChannel,
    redGreenComposite,
    glassComposite,
  );
  defs.append(filter);
  svg.append(defs);
  document.body.prepend(svg);
}

function createLiquidGlassDisplacementNode(namespace, id, result, scale) {
  const displacement = document.createElementNS(namespace, "feDisplacementMap");
  displacement.id = id;
  displacement.setAttribute("in", "SourceGraphic");
  displacement.setAttribute("in2", "liquidMap");
  displacement.setAttribute("scale", scale);
  displacement.setAttribute("xChannelSelector", "R");
  displacement.setAttribute("yChannelSelector", "G");
  displacement.setAttribute("result", result);
  return displacement;
}

function createLiquidGlassColorMatrixNode(namespace, source, result, values) {
  const matrix = document.createElementNS(namespace, "feColorMatrix");
  matrix.setAttribute("in", source);
  matrix.setAttribute("type", "matrix");
  matrix.setAttribute("values", values);
  matrix.setAttribute("result", result);
  return matrix;
}

function createLiquidGlassCompositeNode(namespace, source, source2, result) {
  const composite = document.createElementNS(namespace, "feComposite");
  composite.setAttribute("in", source);
  composite.setAttribute("in2", source2);
  composite.setAttribute("operator", "arithmetic");
  composite.setAttribute("k2", "1");
  composite.setAttribute("k3", "1");
  composite.setAttribute("result", result);
  return composite;
}

function updateLiquidGlassFilterForActivePreview() {
  const preview = Array.from(document.querySelectorAll(LIQUID_GLASS_PREVIEW_SELECTOR))
    .find((node) => node instanceof HTMLElement && !node.hidden && node.classList.contains("is-visible"));
  if (preview instanceof HTMLElement && !preview.hidden) {
    updateLiquidGlassFilterForPreview(preview);
  }
}

function updateLiquidGlassFilterForPreview(preview) {
  if (document.documentElement.dataset.rulePreviewMaterial !== "liquid-glass") {
    return;
  }

  ensureLiquidGlassFilter();
  const rect = preview.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const style = getComputedStyle(preview);
  const radius = Number.parseFloat(style.borderTopLeftRadius) || 24;
  const mapWidth = clamp(Math.round(rect.width / 2), 96, 220);
  const mapHeight = clamp(Math.round(rect.height / 2), 64, 180);
  const mapRadius = clamp(Math.round(radius * mapWidth / rect.width), 8, Math.min(mapWidth, mapHeight) / 2);
  const filterScale = clamp(Math.round(Math.min(rect.width, rect.height) * 0.16), 12, 32);
  const chromaScale = clamp(Math.round(filterScale * 0.28), 4, 9);
  const signature = `${mapWidth}x${mapHeight}:${mapRadius}:${filterScale}:${chromaScale}`;

  if (runtime.liquidGlassFilterSignature === signature) {
    return;
  }

  const map = document.getElementById(LIQUID_GLASS_FILTER_MAP_ID);
  if (!map) {
    return;
  }

  const dataUrl = getLiquidGlassRefractionMapDataUrl(mapWidth, mapHeight, mapRadius);
  setSvgHref(map, dataUrl);
  document.getElementById(LIQUID_GLASS_DISPLACEMENT_ID)?.setAttribute("scale", String(filterScale));
  document.getElementById(LIQUID_GLASS_RED_DISPLACEMENT_ID)
    ?.setAttribute("scale", String(filterScale + chromaScale));
  document.getElementById(LIQUID_GLASS_BLUE_DISPLACEMENT_ID)
    ?.setAttribute("scale", String(Math.max(1, filterScale - chromaScale)));
  runtime.liquidGlassFilterSignature = signature;
}

function getLiquidGlassRefractionMapDataUrl(width, height, radius) {
  const key = `${width}x${height}:${radius}`;
  const cached = runtime.liquidGlassMapCache.get(key);
  if (cached) {
    return cached;
  }

  const dataUrl = createLiquidGlassRefractionMapDataUrl(width, height, radius);
  runtime.liquidGlassMapCache.set(key, dataUrl);
  if (runtime.liquidGlassMapCache.size > 8) {
    runtime.liquidGlassMapCache.delete(runtime.liquidGlassMapCache.keys().next().value);
  }
  return dataUrl;
}

function setLiquidGlassHighlightFromClientPoint(preview, clientX, clientY) {
  const rect = preview.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const x = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  const y = clamp(((clientY - rect.top) / rect.height) * 100, 0, 100);
  preview.style.setProperty("--liquid-glass-x", `${x.toFixed(1)}%`);
  preview.style.setProperty("--liquid-glass-y", `${y.toFixed(1)}%`);
}

function setSvgHref(node, value) {
  node.setAttribute("href", value);
  node.setAttributeNS("http://www.w3.org/1999/xlink", "href", value);
}

function createNeutralLiquidGlassMapDataUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  const imageData = context.createImageData(1, 1);
  imageData.data.set([128, 128, 128, 255]);
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function createLiquidGlassRefractionMapDataUrl(width, height, radius) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return createNeutralLiquidGlassMapDataUrl();
  }

  const imageData = context.createImageData(width, height);
  const data = imageData.data;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const minDimension = Math.min(width, height);
  const safeRadius = clamp(radius, 1, minDimension / 2);
  const controls = LIQUID_GLASS_CONTROLS;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      const centeredX = px - halfWidth;
      const centeredY = py - halfHeight;
      const { distance, normalX, normalY } = getRoundedRectSignedDistanceAndNormal(
        centeredX,
        centeredY,
        halfWidth,
        halfHeight,
        safeRadius,
      );
      if (distance > 0) {
        data[index] = 128;
        data[index + 1] = 128;
        data[index + 2] = 128;
        data[index + 3] = 255;
        continue;
      }

      const insideDistance = Math.max(-distance, 0);
      const distFromEdge = insideDistance / minDimension;
      const baseIntensity = 1 - Math.exp(-insideDistance * controls.baseDistance);
      const edgeIntensity = Math.exp(-insideDistance * controls.edgeDistance);
      const rimIntensity = Math.exp(-insideDistance * controls.rimDistance);
      const baseComponent = controls.warp ? baseIntensity * controls.baseIntensity : 0;
      const edgeComponent = edgeIntensity * controls.edgeIntensity;
      const rimComponent = rimIntensity * controls.rimIntensity;
      const totalIntensity = baseComponent + edgeComponent + rimComponent;
      const cornerDistance = Math.max(
        Math.min(px / width, 1 - px / width),
        Math.min(py / height, 1 - py / height),
      ) * minDimension;
      const cornerBoost = Math.exp(-cornerDistance * 0.3) * controls.cornerBoost;
      const ripple = Math.sin(distFromEdge * 25) * controls.rippleEffect * rimIntensity;
      const tangentX = -normalY;
      const tangentY = normalX;
      const offsetX = (normalX * (totalIntensity + cornerBoost) + tangentX * ripple) * LIQUID_GLASS_CHANNEL_GAIN;
      const offsetY = (normalY * (totalIntensity + cornerBoost) + tangentY * ripple) * LIQUID_GLASS_CHANNEL_GAIN;

      data[index] = clamp(Math.round(128 + offsetX * 127), 0, 255);
      data[index + 1] = clamp(Math.round(128 + offsetY * 127), 0, 255);
      data[index + 2] = 128;
      data[index + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function getRoundedRectSignedDistanceAndNormal(x, y, halfWidth, halfHeight, radius) {
  const cornerX = Math.abs(x) - (halfWidth - radius);
  const cornerY = Math.abs(y) - (halfHeight - radius);
  const outsideX = Math.max(cornerX, 0);
  const outsideY = Math.max(cornerY, 0);
  const outsideDistance = Math.hypot(outsideX, outsideY);
  const insideDistance = Math.min(Math.max(cornerX, cornerY), 0);
  const distance = outsideDistance + insideDistance - radius;
  const normalizedX = x / Math.max(halfWidth * 2, 1);
  const normalizedY = y / Math.max(halfHeight * 2, 1);
  const normalLength = Math.hypot(normalizedX, normalizedY) || 1;

  return {
    distance,
    normalX: normalizedX / normalLength,
    normalY: normalizedY / normalLength,
  };
}

function initReportTitleColorMask(root, info) {
  if (!root || isAppPowerConstrained()) {
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
  if (!runtime.appTitleColorMaskPromise) {
    runtime.appTitleColorMaskPromise = import("./app/app-title-effects.js")
      .then(({ initAppTitleColorMask }) => initAppTitleColorMask)
      .catch((error) => {
        runtime.appTitleColorMaskPromise = null;
        throw error;
      });
  }

  return runtime.appTitleColorMaskPromise;
}

async function hydrateReportSdkIconsForHistory(report) {
  const { hydrateReportSdkIcons } = await loadReportSdkMetadataModule();
  return hydrateReportSdkIcons(report);
}

function loadReportSdkMetadataModule() {
  if (!runtime.reportSdkMetadataModulePromise) {
    runtime.reportSdkMetadataModulePromise = import("./app/sdk-icon-cache.js")
      .then((module) => module)
      .catch((error) => {
        runtime.reportSdkMetadataModulePromise = null;
        throw error;
      });
  }

  return runtime.reportSdkMetadataModulePromise;
}

function loadLcappsSdkAnnotationModule() {
  if (!runtime.lcappsSdkAnnotationModulePromise) {
    runtime.lcappsSdkAnnotationModulePromise = import("./app/lcapps-sdk-annotation.js")
      .then((module) => module)
      .catch((error) => {
        runtime.lcappsSdkAnnotationModulePromise = null;
        throw error;
      });
  }

  return runtime.lcappsSdkAnnotationModulePromise;
}

function scheduleReportSdkRuleDetailHydration(report) {
  if (!report || typeof report !== "object") {
    return;
  }

  const token = runtime.reportSdkMetadataHydrationToken + 1;
  runtime.reportSdkMetadataHydrationToken = token;
  const hydrate = () => {
    void loadReportSdkMetadataModule()
      .then(({ hydrateReportSdkRuleDetails }) => hydrateReportSdkRuleDetails(report))
      .then(() => {
        if (runtime.reportSdkMetadataHydrationToken !== token || state.report !== report) {
          return;
        }
        renderReport();
      })
      .catch(() => {
        // Rule details are hover-only metadata; the analyzed report remains usable without them.
      });
  };

  if (isAppPowerConstrained()) {
    window.setTimeout(hydrate, 4200);
  } else if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(hydrate, { timeout: 1800 });
  } else {
    window.setTimeout(hydrate, 0);
  }
}

function resolveInitialLocale() {
  const browserLocales = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];
  return resolvePreferredLocale(browserLocales, "en");
}

function applyFilePickerAcceptCompatibilityWhenReady() {
  const apply = () => {
    void import("./app/file-picker-support.js")
      .then(({ applyFilePickerAcceptCompatibility }) => {
        applyFilePickerAcceptCompatibility([elements.fileInput, ...elements.compareFileInputs]);
      })
      .catch(() => {});
  };

  window.setTimeout(apply, 3200);
}

applyThemeChoice(state.themeChoice, { persist: false });
initPowerModeAdaptation();
applyFilePickerAcceptCompatibilityWhenReady();
renderLanguageOptions();
applyLocale();
renderBrandTitle(elements.brandTitle, t("title"));
initBrandTitleColorMaskWhenIdle(elements.brandTitle);
renderHistoryList();
updateHistoryCollapse();
updateAppMode();
bindEvents();
initColorOrbBackground();
initWebAnalytics(() => ({
  locale: state.locale,
  ui_mode: state.appMode,
  theme_choice: state.themeChoice,
  color_scheme: document.documentElement.dataset.colorScheme || "",
  history_count: state.history.length,
  viewport_width: window.innerWidth || 0,
  viewport_height: window.innerHeight || 0,
}));
appendRuntimeLog("info", "WebUI ready", {
  version: APP_VERSION,
  locale: state.locale,
});

function bindEvents() {
  elements.modeChipGroup.addEventListener("click", handleModeChipGroupClick);
  elements.modeChipGroup.addEventListener("pointerdown", beginModeDrag);

  elements.themeChipGroup.addEventListener("click", handleThemeChipGroupClick);
  elements.themeChipGroup.addEventListener("pointerdown", beginThemeDrag);

  elements.historyViewGroup?.addEventListener("click", handleHistoryViewGroupClick);
  elements.historyViewGroup?.addEventListener("pointerdown", beginHistoryViewDrag);

  elements.tabs.addEventListener("click", handleReportTabsClick);
  elements.tabs.addEventListener("pointerdown", beginTabDrag);

  document.addEventListener("pointermove", updateModeDrag);
  document.addEventListener("pointerup", endModeDrag);
  document.addEventListener("pointercancel", cancelModeDrag);
  document.addEventListener("pointermove", updateThemeDrag);
  document.addEventListener("pointerup", endThemeDrag);
  document.addEventListener("pointercancel", cancelThemeDrag);
  document.addEventListener("pointermove", updateHistoryViewDrag);
  document.addEventListener("pointerup", endHistoryViewDrag);
  document.addEventListener("pointercancel", cancelHistoryViewDrag);
  document.addEventListener("pointermove", updateTabDrag);
  document.addEventListener("pointerup", endTabDrag);
  document.addEventListener("pointercancel", cancelTabDrag);

  systemThemeMedia.addEventListener("change", () => {
    if (state.themeChoice === "system") {
      applyThemeChoice("system", { persist: false });
    }
  });

  window.addEventListener("resize", () => {
    updateModeIndicator();
    updateThemeIndicator();
    updateHistoryViewIndicator();
    updateTabIndicator();
  });
  window.addEventListener("pagehide", flushScheduledHistoryReports);

  elements.languageSelect.addEventListener("change", () => {
    const previousLocale = state.locale;
    state.locale = normalizeLocale(elements.languageSelect.value);
    renderLanguageOptions();
    applyLocale();
    updateModeIndicator();
    updateThemeIndicator();
    updateHistoryViewIndicator();
    updateTabIndicator();
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

  elements.linkInput?.addEventListener("input", () => {
    setDownloadUrl(elements.linkInput.value || "");
  });
  elements.linkClearButton?.addEventListener("click", () => {
    setDownloadUrl("", { syncInput: true });
    elements.linkInput?.focus();
  });
  elements.runtimeLogOpen?.addEventListener("click", openRuntimeLogModal);
  elements.runtimeLogExport?.addEventListener("click", exportRuntimeLogs);
  elements.runtimeLogClose?.addEventListener("click", closeRuntimeLogModal);
  elements.runtimeLogModal?.addEventListener("click", (event) => {
    if (event.target === elements.runtimeLogModal) {
      closeRuntimeLogModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.runtimeLogOpen) {
      closeRuntimeLogModal();
    }
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
    if (state.selectedFile) {
      analyzeSelectedFile();
    } else {
      analyzeDownloadUrl();
    }
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

  elements.lcappsPickerClose?.addEventListener("click", () => {
    closeLcappsPicker();
  });

  elements.lcappsPicker?.addEventListener("click", (event) => {
    if (event.target === elements.lcappsPicker) {
      closeLcappsPicker();
    }
  });

  elements.lcappsSearch?.addEventListener("input", () => {
    state.lcappsPicker.query = elements.lcappsSearch.value || "";
    renderLcappsPicker();
  });

  elements.lcappsGrid?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-lcapps-index]");
    if (!button) {
      return;
    }

    const index = Number.parseInt(button.dataset.lcappsIndex || "", 10);
    if (Number.isFinite(index)) {
      void selectLcappsReport(index);
    }
  });

  elements.lcappsBubble?.addEventListener("click", () => {
    reopenLcappsPicker();
  });

  elements.clearButton?.addEventListener("click", () => {
    if (state.appMode === "compare") {
      if (runtime.compareController) {
        runtime.compareController.reset();
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.lcappsPicker.open) {
      closeLcappsPicker();
    }
  });

  document.addEventListener("pointerover", (event) => {
    const row = event.target.closest?.(".history-row");
    if (elements.historyList.contains(event.target) || (row && elements.historyList.contains(row))) {
      return;
    }

    clearHistoryPointerState();
  });

  elements.tabPanel.addEventListener("click", (event) => {
    const exportButton = event.target.closest("[data-json-export]");
    if (exportButton) {
      if (state.report) {
        runtime.reportRendererModule?.downloadReport(state.report, elements.tabPanel.querySelector(".json-block")?.textContent || "");
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

function handleModeChipGroupClick(event) {
  if (event.defaultPrevented) {
    return;
  }

  if (modeDrag.suppressClick) {
    event.preventDefault();
    modeDrag.suppressClick = false;
    return;
  }

  const button = getSegmentButtonFromClick(event, elements.modeChipGroup, ".mode-chip");
  const appMode = button?.dataset.appMode || getAppModeAtClientX(event.clientX);
  setAppMode(appMode);
}

function handleThemeChipGroupClick(event) {
  if (event.defaultPrevented) {
    return;
  }

  if (themeDrag.suppressClick) {
    event.preventDefault();
    themeDrag.suppressClick = false;
    return;
  }

  const button = getSegmentButtonFromClick(event, elements.themeChipGroup, ".theme-chip");
  const themeChoice = button?.dataset.themeChoice || getThemeChoiceAtClientX(event.clientX);
  applyThemeChoice(themeChoice);
}

function handleHistoryViewGroupClick(event) {
  if (event.defaultPrevented) {
    return;
  }

  if (historyViewDrag.suppressClick) {
    event.preventDefault();
    historyViewDrag.suppressClick = false;
    return;
  }

  const button = getSegmentButtonFromClick(event, elements.historyViewGroup, ".history-view-button");
  const viewMode = button?.dataset.historyViewMode || getHistoryViewModeAtClientX(event.clientX);
  setHistoryViewMode(viewMode);
}

function handleReportTabsClick(event) {
  if (event.defaultPrevented) {
    return;
  }

  if (tabDrag.suppressClick) {
    event.preventDefault();
    tabDrag.suppressClick = false;
    return;
  }

  const button = getSegmentButtonFromClick(event, elements.tabs, ".tab");
  const tab = button?.dataset.tab || getReportTabAtClientX(event.clientX);
  setActiveTab(tab);
}

function ensureReportPreviewInteractions() {
  if (!runtime.reportPreviewInteractionsPromise) {
    runtime.reportPreviewInteractionsPromise = import("./app/report-preview-interactions.js")
      .then(({ initReportPreviewInteractions }) => {
        initReportPreviewInteractions({
          runtime,
          state,
          t,
          ensureRulePreviewMaterial,
          updateLiquidGlassFilterForPreview,
          setLiquidGlassHighlightFromClientPoint,
          scheduleRulePreviewMaterialWarmup,
        });
      })
      .catch((error) => {
        runtime.reportPreviewInteractionsPromise = null;
        throw error;
      });
  }

  return runtime.reportPreviewInteractionsPromise;
}

function preloadReportPreviewInteractions() {
  void ensureReportPreviewInteractions().catch(() => {});
}

function beginModeDrag(event) {
  if (event.button !== 0) {
    return;
  }

  modeDrag.active = true;
  modeDrag.dragging = false;
  modeDrag.scrolling = false;
  modeDrag.pointerId = event.pointerId;
  modeDrag.startClientX = event.clientX;
  modeDrag.startClientY = event.clientY;
  modeDrag.scrollStartLeft = elements.topbarActions?.scrollLeft || 0;
  modeDrag.startedOnActiveSegment = isPointerOnActiveSegmentButton(
    event,
    elements.modeChipGroup,
    ".mode-chip",
  );
  modeDrag.pendingMode = "";
  modeDrag.suppressClick = false;
  modeDrag.buttonCenters = measureChoiceCenters(elements.modeButtons, "appMode");
  captureSegmentPointer(elements.modeChipGroup, event);
}

function updateModeDrag(event) {
  if (!modeDrag.active || event.pointerId !== modeDrag.pointerId) {
    return;
  }

  if (!maybeStartSegmentDrag(event, modeDrag, elements.modeChipGroup)) {
    return;
  }
  previewModeFromPointer(event);
}

function endModeDrag(event) {
  if (!modeDrag.active || event.pointerId !== modeDrag.pointerId) {
    return;
  }

  if (maybeStartSegmentDrag(event, modeDrag, elements.modeChipGroup)) {
    previewModeFromPointer(event);
    if (modeDrag.pendingMode) {
      setAppMode(modeDrag.pendingMode);
    }
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
  const wasDragging = modeDrag.dragging;
  elements.modeChipGroup.classList.remove("is-dragging");
  modeDrag.active = false;
  modeDrag.dragging = false;
  modeDrag.scrolling = false;
  modeDrag.pointerId = null;
  modeDrag.startClientX = 0;
  modeDrag.startClientY = 0;
  modeDrag.scrollStartLeft = 0;
  modeDrag.startedOnActiveSegment = false;
  modeDrag.pendingMode = "";
  modeDrag.buttonCenters = [];
  clearModePendingButtons();
  if (wasDragging) {
    updateModeIndicator();
  }
  try {
    if (elements.modeChipGroup.hasPointerCapture?.(pointerId)) {
      elements.modeChipGroup.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
  if (!wasDragging) {
    if (modeDrag.suppressClick) {
      window.setTimeout(() => {
        modeDrag.suppressClick = false;
      }, 0);
      return;
    }
    modeDrag.suppressClick = false;
    return;
  }

  window.setTimeout(() => {
    modeDrag.suppressClick = false;
  }, 0);
}

function previewModeFromPointer(event) {
  const appMode = getAppModeAtClientX(event.clientX);
  updateSegmentIndicatorFromPointer(
    elements.modeChipGroup,
    modeDrag.buttonCenters,
    appMode,
    event.clientX,
    "mode",
  );
  if (!appMode || appMode === modeDrag.pendingMode) {
    return;
  }

  modeDrag.pendingMode = appMode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("is-pending", button.dataset.appMode === appMode);
  });
}

function getAppModeAtClientX(clientX) {
  return getNearestChoiceAtClientX(clientX, modeDrag.buttonCenters, elements.modeButtons, "appMode");
}

function beginThemeDrag(event) {
  if (event.button !== 0) {
    return;
  }

  themeDrag.active = true;
  themeDrag.dragging = false;
  themeDrag.scrolling = false;
  themeDrag.pointerId = event.pointerId;
  themeDrag.startClientX = event.clientX;
  themeDrag.startClientY = event.clientY;
  themeDrag.scrollStartLeft = elements.topbarActions?.scrollLeft || 0;
  themeDrag.startedOnActiveSegment = isPointerOnActiveSegmentButton(
    event,
    elements.themeChipGroup,
    ".theme-chip",
  );
  themeDrag.pendingChoice = "";
  themeDrag.suppressClick = false;
  themeDrag.buttonCenters = measureChoiceCenters(elements.themeButtons, "themeChoice");
  captureSegmentPointer(elements.themeChipGroup, event);
}

function updateThemeDrag(event) {
  if (!themeDrag.active || event.pointerId !== themeDrag.pointerId) {
    return;
  }

  if (!maybeStartSegmentDrag(event, themeDrag, elements.themeChipGroup)) {
    return;
  }
  previewThemeChoiceFromPointer(event);
}

function endThemeDrag(event) {
  if (!themeDrag.active || event.pointerId !== themeDrag.pointerId) {
    return;
  }

  if (maybeStartSegmentDrag(event, themeDrag, elements.themeChipGroup)) {
    previewThemeChoiceFromPointer(event);
    if (themeDrag.pendingChoice) {
      applyThemeChoice(themeDrag.pendingChoice);
    }
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
  const wasDragging = themeDrag.dragging;
  elements.themeChipGroup.classList.remove("is-dragging");
  themeDrag.active = false;
  themeDrag.dragging = false;
  themeDrag.scrolling = false;
  themeDrag.pointerId = null;
  themeDrag.startClientX = 0;
  themeDrag.startClientY = 0;
  themeDrag.scrollStartLeft = 0;
  themeDrag.startedOnActiveSegment = false;
  themeDrag.pendingChoice = "";
  themeDrag.buttonCenters = [];
  clearThemePendingButtons();
  if (wasDragging) {
    updateThemeIndicator();
  }
  try {
    if (elements.themeChipGroup.hasPointerCapture?.(pointerId)) {
      elements.themeChipGroup.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
  if (!wasDragging) {
    if (themeDrag.suppressClick) {
      window.setTimeout(() => {
        themeDrag.suppressClick = false;
      }, 0);
      return;
    }
    themeDrag.suppressClick = false;
    return;
  }

  window.setTimeout(() => {
    themeDrag.suppressClick = false;
  }, 0);
}

function previewThemeChoiceFromPointer(event) {
  const themeChoice = getThemeChoiceAtClientX(event.clientX);
  updateSegmentIndicatorFromPointer(
    elements.themeChipGroup,
    themeDrag.buttonCenters,
    themeChoice,
    event.clientX,
    "theme",
  );
  if (!themeChoice || themeChoice === themeDrag.pendingChoice) {
    return;
  }

  themeDrag.pendingChoice = themeChoice;
  elements.themeButtons.forEach((button) => {
    button.classList.toggle("is-pending", button.dataset.themeChoice === themeChoice);
  });
}

function getThemeChoiceAtClientX(clientX) {
  return getNearestChoiceAtClientX(clientX, themeDrag.buttonCenters, elements.themeButtons, "themeChoice");
}

function beginHistoryViewDrag(event) {
  if (event.button !== 0 || !elements.historyViewGroup) {
    return;
  }

  historyViewDrag.active = true;
  historyViewDrag.dragging = false;
  historyViewDrag.scrolling = false;
  historyViewDrag.pointerId = event.pointerId;
  historyViewDrag.startClientX = event.clientX;
  historyViewDrag.startClientY = event.clientY;
  historyViewDrag.scrollStartLeft = 0;
  historyViewDrag.startedOnActiveSegment = isPointerOnActiveSegmentButton(
    event,
    elements.historyViewGroup,
    ".history-view-button",
  );
  historyViewDrag.pendingViewMode = "";
  historyViewDrag.suppressClick = false;
  historyViewDrag.buttonCenters = measureChoiceCenters(elements.historyViewButtons, "historyViewMode");
  captureSegmentPointer(elements.historyViewGroup, event);
}

function updateHistoryViewDrag(event) {
  if (!historyViewDrag.active || event.pointerId !== historyViewDrag.pointerId) {
    return;
  }

  if (!maybeStartSegmentDrag(event, historyViewDrag, elements.historyViewGroup, { allowTopbarScroll: false })) {
    return;
  }
  previewHistoryViewFromPointer(event);
}

function endHistoryViewDrag(event) {
  if (!historyViewDrag.active || event.pointerId !== historyViewDrag.pointerId) {
    return;
  }

  if (maybeStartSegmentDrag(event, historyViewDrag, elements.historyViewGroup, { allowTopbarScroll: false })) {
    previewHistoryViewFromPointer(event);
    if (historyViewDrag.pendingViewMode) {
      setHistoryViewMode(historyViewDrag.pendingViewMode);
    }
  }
  finishHistoryViewDrag(event.pointerId);
}

function cancelHistoryViewDrag(event) {
  if (!historyViewDrag.active || event.pointerId !== historyViewDrag.pointerId) {
    return;
  }

  finishHistoryViewDrag(event.pointerId);
}

function finishHistoryViewDrag(pointerId) {
  const wasDragging = historyViewDrag.dragging;
  elements.historyViewGroup?.classList.remove("is-dragging");
  historyViewDrag.active = false;
  historyViewDrag.dragging = false;
  historyViewDrag.scrolling = false;
  historyViewDrag.pointerId = null;
  historyViewDrag.startClientX = 0;
  historyViewDrag.startClientY = 0;
  historyViewDrag.scrollStartLeft = 0;
  historyViewDrag.startedOnActiveSegment = false;
  historyViewDrag.pendingViewMode = "";
  historyViewDrag.buttonCenters = [];
  clearHistoryViewPendingButtons();
  if (wasDragging) {
    updateHistoryViewIndicator();
  }
  try {
    if (elements.historyViewGroup?.hasPointerCapture?.(pointerId)) {
      elements.historyViewGroup.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
  if (!wasDragging) {
    if (historyViewDrag.suppressClick) {
      window.setTimeout(() => {
        historyViewDrag.suppressClick = false;
      }, 0);
      return;
    }
    historyViewDrag.suppressClick = false;
    return;
  }

  window.setTimeout(() => {
    historyViewDrag.suppressClick = false;
  }, 0);
}

function previewHistoryViewFromPointer(event) {
  const viewMode = getHistoryViewModeAtClientX(event.clientX);
  updateSegmentIndicatorFromPointer(
    elements.historyViewGroup,
    historyViewDrag.buttonCenters,
    viewMode,
    event.clientX,
    "history-view",
  );
  if (!viewMode || viewMode === historyViewDrag.pendingViewMode) {
    return;
  }

  historyViewDrag.pendingViewMode = viewMode;
  elements.historyViewButtons.forEach((button) => {
    button.classList.toggle("is-pending", button.dataset.historyViewMode === viewMode);
  });
}

function getHistoryViewModeAtClientX(clientX) {
  return getNearestChoiceAtClientX(clientX, historyViewDrag.buttonCenters, elements.historyViewButtons, "historyViewMode");
}

function beginTabDrag(event) {
  if (event.button !== 0 || !elements.tabs) {
    return;
  }

  tabDrag.active = true;
  tabDrag.dragging = false;
  tabDrag.scrolling = false;
  tabDrag.pointerId = event.pointerId;
  tabDrag.startClientX = event.clientX;
  tabDrag.startClientY = event.clientY;
  tabDrag.scrollStartLeft = elements.tabs.scrollLeft || 0;
  tabDrag.startedOnActiveSegment = isPointerOnActiveSegmentButton(
    event,
    elements.tabs,
    ".tab",
  );
  tabDrag.pendingTab = "";
  tabDrag.suppressClick = false;
  tabDrag.buttonCenters = measureChoiceCenters(elements.tabButtons, "tab");
  captureSegmentPointer(elements.tabs, event);
}

function updateTabDrag(event) {
  if (!tabDrag.active || event.pointerId !== tabDrag.pointerId) {
    return;
  }

  if (!maybeStartSegmentDrag(event, tabDrag, elements.tabs, {
    allowSegmentScroll: true,
    allowTopbarScroll: false,
    scrollElement: elements.tabs,
  })) {
    return;
  }
  previewReportTabFromPointer(event);
}

function endTabDrag(event) {
  if (!tabDrag.active || event.pointerId !== tabDrag.pointerId) {
    return;
  }

  if (maybeStartSegmentDrag(event, tabDrag, elements.tabs, {
    allowSegmentScroll: true,
    allowTopbarScroll: false,
    scrollElement: elements.tabs,
  })) {
    previewReportTabFromPointer(event);
    if (tabDrag.pendingTab) {
      setActiveTab(tabDrag.pendingTab);
    }
  }
  finishTabDrag(event.pointerId);
}

function cancelTabDrag(event) {
  if (!tabDrag.active || event.pointerId !== tabDrag.pointerId) {
    return;
  }

  finishTabDrag(event.pointerId);
}

function finishTabDrag(pointerId) {
  const wasDragging = tabDrag.dragging;
  elements.tabs.classList.remove("is-dragging");
  tabDrag.active = false;
  tabDrag.dragging = false;
  tabDrag.scrolling = false;
  tabDrag.pointerId = null;
  tabDrag.startClientX = 0;
  tabDrag.startClientY = 0;
  tabDrag.scrollStartLeft = 0;
  tabDrag.startedOnActiveSegment = false;
  tabDrag.pendingTab = "";
  tabDrag.buttonCenters = [];
  clearTabPendingButtons();
  if (wasDragging) {
    updateTabIndicator();
  }
  try {
    if (elements.tabs.hasPointerCapture?.(pointerId)) {
      elements.tabs.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer may already have been released by the browser.
  }
  if (!wasDragging) {
    if (tabDrag.suppressClick) {
      window.setTimeout(() => {
        tabDrag.suppressClick = false;
      }, 0);
      return;
    }
    tabDrag.suppressClick = false;
    return;
  }

  window.setTimeout(() => {
    tabDrag.suppressClick = false;
  }, 0);
}

function previewReportTabFromPointer(event) {
  const tab = getReportTabAtClientX(event.clientX);
  updateSegmentIndicatorFromPointer(
    elements.tabs,
    tabDrag.buttonCenters,
    tab,
    event.clientX,
    "tab",
  );
  if (!tab || tab === tabDrag.pendingTab) {
    return;
  }

  tabDrag.pendingTab = tab;
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("is-pending", button.dataset.tab === tab);
  });
}

function getReportTabAtClientX(clientX) {
  return getNearestChoiceAtClientX(clientX, tabDrag.buttonCenters, elements.tabButtons, "tab");
}

function maybeStartSegmentDrag(event, dragState, group, options = {}) {
  if (dragState.dragging) {
    event.preventDefault();
    return true;
  }

  if (dragState.scrolling) {
    scrollSegmentFromPointer(event, dragState, options.scrollElement || elements.topbarActions);
    return false;
  }

  const deltaX = event.clientX - dragState.startClientX;
  const deltaY = event.clientY - dragState.startClientY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);
  if (
    absDeltaX < SEGMENT_DRAG_START_THRESHOLD_PX ||
    absDeltaX < absDeltaY
  ) {
    return false;
  }

  if (
    options.allowSegmentScroll &&
    shouldStartSegmentScroll(event, dragState, absDeltaX, options.scrollElement)
  ) {
    startSegmentScroll(event, dragState, options.scrollElement);
    return false;
  }

  if (options.allowTopbarScroll !== false && shouldStartTopbarSegmentScroll(event, dragState, absDeltaX)) {
    startSegmentScroll(event, dragState, elements.topbarActions);
    return false;
  }

  const dragThreshold = isMobileTopbarSegmentPointer(event)
    ? SEGMENT_TOUCH_DRAG_START_THRESHOLD_PX
    : SEGMENT_DRAG_START_THRESHOLD_PX;
  if (absDeltaX < dragThreshold) {
    return false;
  }

  dragState.dragging = true;
  dragState.suppressClick = true;
  group.classList.add("is-dragging");
  captureSegmentPointer(group, event);
  event.preventDefault();
  return true;
}

function captureSegmentPointer(group, event) {
  try {
    group.setPointerCapture?.(event.pointerId);
  } catch {
    // Pointer capture is an enhancement; document-level dragging still works without it.
  }
}

function shouldStartTopbarSegmentScroll(event, dragState, absDeltaX) {
  return !dragState.startedOnActiveSegment &&
    absDeltaX >= TOPBAR_SEGMENT_SCROLL_START_THRESHOLD_PX &&
    isMobileTopbarSegmentPointer(event) &&
    isScrollableTopbarActions(elements.topbarActions);
}

function shouldStartSegmentScroll(event, dragState, absDeltaX, scroller) {
  return !dragState.startedOnActiveSegment &&
    absDeltaX >= TOPBAR_SEGMENT_SCROLL_START_THRESHOLD_PX &&
    isMobileTopbarSegmentPointer(event) &&
    isScrollableTopbarActions(scroller);
}

function startSegmentScroll(event, dragState, scroller) {
  dragState.scrolling = true;
  dragState.suppressClick = true;
  scrollSegmentFromPointer(event, dragState, scroller);
}

function scrollSegmentFromPointer(event, dragState, scroller) {
  if (!scroller) {
    return;
  }

  scroller.scrollLeft = dragState.scrollStartLeft - (event.clientX - dragState.startClientX);
}

function isMobileTopbarSegmentPointer(event) {
  return event.pointerType === "touch" || event.pointerType === "pen" || mobileTopbarMedia.matches;
}

function isScrollableTopbarActions(scroller) {
  return Boolean(scroller && scroller.scrollWidth - scroller.clientWidth > TOPBAR_SCROLL_EPSILON_PX);
}

function isPointerOnActiveSegmentButton(event, group, selector) {
  const button = getSegmentButtonFromClick(event, group, selector);
  return Boolean(button?.classList.contains("is-active"));
}

function measureChoiceCenters(buttons, datasetKey) {
  return buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return {
      value: button.dataset[datasetKey] || "",
      centerX: rect.left + rect.width / 2,
      width: rect.width,
    };
  });
}

function updateSegmentIndicatorFromPointer(group, measuredChoices, value, clientX, prefix) {
  if (!group || !value) {
    return;
  }

  const groupRect = group.getBoundingClientRect();
  const groupStyle = getComputedStyle(group);
  const inset = Number.parseFloat(groupStyle.getPropertyValue("--topbar-segment-inset")) || 0;
  const scrollLeft = group.scrollLeft || 0;
  const activeChoice = measuredChoices.find((choice) => choice.value === value);
  const thumbWidth = activeChoice?.width ||
    Number.parseFloat(groupStyle.getPropertyValue(`--${prefix}-indicator-width`)) ||
    0;
  if (thumbWidth <= 0) {
    return;
  }

  const minX = inset;
  const contentWidth = Math.max(group.scrollWidth || 0, groupRect.width);
  const maxX = Math.max(minX, contentWidth - inset - thumbWidth);
  const pointerX = clientX - groupRect.left + scrollLeft - thumbWidth / 2;
  const x = clamp(pointerX, minX, maxX);
  group.style.setProperty(`--${prefix}-indicator-x`, `${x.toFixed(1)}px`);
  group.style.setProperty(`--${prefix}-indicator-width`, `${thumbWidth.toFixed(1)}px`);
}

function getSegmentButtonFromClick(event, group, selector) {
  const targetButton = event.target instanceof Element
    ? event.target.closest(selector)
    : null;
  if (targetButton && group.contains(targetButton)) {
    return targetButton;
  }

  const hitTarget = document.elementFromPoint(event.clientX, event.clientY);
  const hitButton = hitTarget instanceof Element
    ? hitTarget.closest(selector)
    : null;
  return hitButton && group.contains(hitButton) ? hitButton : null;
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
  if (!node || isAppPowerConstrained()) {
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
  let currentX = null;
  let currentY = null;
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

  const shouldResetPosition = (eventType) => (
    eventType === "pointerdown" ||
    eventType === "pointerenter" ||
    eventType === "pointerover"
  );

  const scheduleFrame = () => {
    if (!frameId) {
      frameId = window.requestAnimationFrame(apply);
    }
  };

  const apply = () => {
    frameId = 0;
    if (!node.isConnected) {
      rect = null;
      currentX = null;
      currentY = null;
      return;
    }

    if (!rect) {
      readRect();
    }

    const targetX = clamp(pendingClientX - rect.left, 0, rect.width);
    const targetY = clamp(pendingClientY - rect.top, 0, rect.height);

    if (currentX == null || currentY == null) {
      currentX = targetX;
      currentY = targetY;
    } else {
      const deltaX = targetX - currentX;
      const deltaY = targetY - currentY;
      const distance = Math.hypot(deltaX, deltaY);
      const alpha = clamp(
        distance / POINTER_SPOTLIGHT_DISTANCE_FOR_MAX_ALPHA,
        POINTER_SPOTLIGHT_MIN_ALPHA,
        POINTER_SPOTLIGHT_MAX_ALPHA,
      );
      currentX += deltaX * alpha;
      currentY += deltaY * alpha;
    }

    const nextX = `${currentX.toFixed(1)}px`;
    const nextY = `${currentY.toFixed(1)}px`;

    if (nextX !== lastX) {
      node.style.setProperty(xProperty, nextX);
      lastX = nextX;
    }
    if (nextY !== lastY) {
      node.style.setProperty(yProperty, nextY);
      lastY = nextY;
    }

    if (Math.hypot(targetX - currentX, targetY - currentY) > POINTER_SPOTLIGHT_REST_DISTANCE) {
      scheduleFrame();
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
      if (shouldResetPosition(eventType)) {
        currentX = null;
        currentY = null;
      }
      scheduleFrame();
    },
    reset() {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
      rect = null;
      currentX = null;
      currentY = null;
      lastX = "";
      lastY = "";
    },
  };
}

function shouldActivatePointerHighlight(event) {
  return !isAppPowerConstrained() && (event.type === "pointerdown" || isFineHoverPointer(event));
}

function shouldClearPointerHighlightOnRelease(event) {
  return !isFineHoverPointer(event);
}

function isFineHoverPointer(event) {
  return event.pointerType === "mouse" && fineHoverMedia.matches;
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
  if (runtime.compareController) {
    runtime.compareController.setVisible(isCompare);
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
  if (!elements.clearButton) {
    return;
  }

  if (state.appMode === "compare") {
    elements.clearButton.disabled = !runtime.compareController?.hasContent();
    return;
  }

  elements.clearButton.disabled = !state.selectedFile && !state.downloadUrl && !state.report;
}

function updateModeIndicator(appMode = state.appMode) {
  runtime.pendingModeIndicatorAppMode = appMode;
  if (runtime.modeIndicatorFrame || !elements.modeChipGroup) {
    return;
  }

  runtime.modeIndicatorFrame = window.requestAnimationFrame(() => {
    runtime.modeIndicatorFrame = 0;
    const indicatorAppMode = runtime.pendingModeIndicatorAppMode || state.appMode;
    const activeButton = elements.modeButtons.find((button) => button.dataset.appMode === indicatorAppMode);
    if (!activeButton || !elements.modeChipGroup) {
      return;
    }

    const groupRect = elements.modeChipGroup.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setSegmentIndicatorGeometry(elements.modeChipGroup, groupRect, buttonRect, "mode");
  });
}

function setSegmentIndicatorGeometry(group, groupRect, buttonRect, prefix) {
  const x = buttonRect.left - groupRect.left + (group.scrollLeft || 0);
  group.style.setProperty(`--${prefix}-indicator-x`, `${Math.max(0, x).toFixed(1)}px`);
  group.style.setProperty(`--${prefix}-indicator-width`, `${buttonRect.width.toFixed(1)}px`);
  group.style.setProperty(`--${prefix}-indicator-height`, `${buttonRect.height.toFixed(1)}px`);
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
  runtime.pendingThemeIndicatorChoice = themeChoice;
  if (runtime.themeIndicatorFrame || !elements.themeChipGroup) {
    return;
  }

  runtime.themeIndicatorFrame = window.requestAnimationFrame(() => {
    runtime.themeIndicatorFrame = 0;
    const indicatorThemeChoice = runtime.pendingThemeIndicatorChoice || state.themeChoice;
    const activeButton = elements.themeButtons.find((button) => button.dataset.themeChoice === indicatorThemeChoice);
    if (!activeButton || !elements.themeChipGroup) {
      return;
    }

    const groupRect = elements.themeChipGroup.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setSegmentIndicatorGeometry(elements.themeChipGroup, groupRect, buttonRect, "theme");
  });
}

function clearThemePendingButtons() {
  elements.themeButtons.forEach((button) => {
    button.classList.remove("is-pending");
  });
}

function setActiveTab(tab) {
  if (!VALID_TABS.has(tab) || tab === state.activeTab) {
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
}

function updateTabIndicator(tab = state.activeTab) {
  runtime.pendingTabIndicatorTab = VALID_TABS.has(tab) ? tab : "summary";
  if (runtime.tabIndicatorFrame || !elements.tabs) {
    return;
  }

  runtime.tabIndicatorFrame = window.requestAnimationFrame(() => {
    runtime.tabIndicatorFrame = 0;
    const indicatorTab = runtime.pendingTabIndicatorTab || state.activeTab;
    const activeButton = elements.tabButtons.find((button) => button.dataset.tab === indicatorTab);
    if (!activeButton || !elements.tabs) {
      return;
    }

    try {
      activeButton.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      activeButton.scrollIntoView();
    }
    const groupRect = elements.tabs.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setSegmentIndicatorGeometry(elements.tabs, groupRect, buttonRect, "tab");
  });
}

function clearTabPendingButtons() {
  elements.tabButtons.forEach((button) => {
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

  elements.i18nNodes.forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  elements.titleI18nNodes.forEach((node) => {
    const value = t(node.dataset.titleI18n);
    node.title = value;
    node.setAttribute("aria-label", value);
  });

  elements.ariaI18nNodes.forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.ariaI18n));
  });

  if (elements.lcappsSearch) {
    elements.lcappsSearch.placeholder = t("lcappsSearch");
    elements.lcappsSearch.setAttribute("aria-label", t("lcappsSearch"));
  }
  if (elements.linkInput) {
    elements.linkInput.placeholder = t("linkPlaceholder");
    elements.linkInput.setAttribute("aria-label", t("linkInputLabel"));
  }
  if (elements.linkClearButton) {
    const label = t("linkClear");
    elements.linkClearButton.setAttribute("aria-label", label);
    elements.linkClearButton.title = label;
  }
  if (elements.appVersion) {
    elements.appVersion.textContent = `v${APP_VERSION}`;
    elements.appVersion.setAttribute("aria-label", t("runtimeLogVersionLabel", { version: APP_VERSION }));
  }
  renderLinkStatus();
  renderHistoryViewMode();
  renderRuntimeLogs();
  renderLcappsPicker();
  renderLcappsBubble();
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
  if (file) {
    setDownloadUrl("", { keepFile: true, syncInput: true });
  }
  state.selectedFile = file;
  renderSelectedFile();
  updateAnalyzeControls();
  updateClearButton();

  if (file) {
    const isLcapps = isLikelyLcapps(file);
    const isValid = isLcapps || isLikelyApk(file);
    trackWebEvent("webui.file.selected", {
      result: isValid ? "valid" : "invalid",
      is_valid: isValid,
      file_kind: isLcapps ? "lcapps" : "android_package",
      ...getFileAnalyticsFields(file),
    });

    if (isLcapps) {
      void openLcappsPickerForFile(file);
    }
  }
}

function setDownloadUrl(value, options = {}) {
  hideError();
  state.downloadUrl = String(value || "").trim();
  state.linkStatusKey = state.downloadUrl ? "linkReady" : "linkIdle";

  if (options.syncInput && elements.linkInput) {
    elements.linkInput.value = state.downloadUrl;
  }

  if (state.downloadUrl && !options.keepFile) {
    state.selectedFile = null;
    elements.fileInput.value = "";
    renderSelectedFile();
  }

  renderLinkStatus();
  updateAnalyzeControls();
  updateClearButton();
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

function renderLinkStatus() {
  if (!elements.linkStatus) {
    return;
  }

  const key = state.linkStatusKey || (state.downloadUrl ? "linkReady" : "linkIdle");
  elements.linkStatus.textContent = t(key);
  elements.linkStatus.classList.toggle("is-active", key !== "linkIdle");
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

  if (isLikelyLcapps(file)) {
    await openLcappsPickerForFile(file);
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

  void loadSdkIconRendererModule().catch(() => {});
  preloadReportRenderer();
  preloadReportPreviewInteractions();
  setBusy(true);
  showProgress("progressReading", { progress: 0 });
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

  /** @type {import("@shared/contracts.js").AnalyzerWorkerRequest} */
  const request = {
    type: "analyze",
    jobId,
    locale: state.locale,
    file,
    terminalSystem,
  };
  worker.postMessage(request);
}

async function analyzeDownloadUrl() {
  hideError();

  let downloadUrl = "";
  try {
    downloadUrl = normalizeDownloadUrl(state.downloadUrl);
  } catch {
    showError(t("invalidLink"));
    state.linkStatusKey = state.downloadUrl ? "linkFailed" : "linkIdle";
    renderLinkStatus();
    trackWebEvent("webui.link_analysis.failed", {
      result: "invalid_url",
      input_source: "url",
      error_name: "InvalidUrl",
    });
    return;
  }

  state.downloadUrl = downloadUrl;
  if (elements.linkInput) {
    elements.linkInput.value = downloadUrl;
  }

  state.jobId += 1;
  const jobId = state.jobId;
  const abortController = new AbortController();
  state.startedAt = performance.now();
  state.report = null;
  state.activeTab = "summary";
  state.activeNativeAbi = "";
  state.activeAnalyzeJobId = jobId;
  state.linkAbortController = abortController;
  state.jobs.set(jobId, {
    type: "url",
  });

  void loadSdkIconRendererModule().catch(() => {});
  preloadReportRenderer();
  preloadReportPreviewInteractions();
  state.linkStatusKey = "linkFetching";
  renderLinkStatus();
  setBusy(true);
  showProgress("progressDownloading", { progress: 0.04 });
  startTimer();
  trackWebEvent("webui.link_analysis.started", {
    result: "started",
    input_source: "url",
  });

  const linkTimings = {};
  try {
    const terminalDetectStartedAt = performance.now();
    const terminalSystem = await detectCurrentTerminalSystem();
    linkTimings.terminal_detect_ms = getElapsedMs(terminalDetectStartedAt);
    if (!state.jobs.has(jobId)) {
      return;
    }

    const fetchStartedAt = performance.now();
    const response = await fetch(URL_REPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "accept": "application/x-ndjson, application/json",
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        url: downloadUrl,
        locale: state.locale,
        terminalSystem,
      }),
      signal: abortController.signal,
    });
    linkTimings.fetch_headers_ms = getElapsedMs(fetchStartedAt);
    linkTimings.http_status = response.status || 0;
    const payload = await parseUrlReportResponse(response, linkTimings, (progressEvent) => {
      if (state.jobs.has(jobId)) {
        updateUrlReportProgress(progressEvent);
      }
    });
    if (!response.ok) {
      throw createUrlReportError(payload, response);
    }
    if (!payload?.report) {
      throw new Error(t("unknownError"));
    }
    if (!state.jobs.has(jobId)) {
      return;
    }

    state.jobs.delete(jobId);
    state.activeAnalyzeJobId = null;
    state.linkAbortController = null;
    state.report = payload.report;
    state.activeNativeAbi = "";
    state.linkStatusKey = "linkDone";
    renderLinkStatus();
    updateClearButton();
    finishAnalysis();
    showProgress("progressDone");
    const renderStartedAt = performance.now();
    void renderReport()
      .then(() => {
        trackWebEvent("webui.link_analysis.rendered", {
          result: "success",
          input_source: "url",
          render_ms: getElapsedMs(renderStartedAt),
          client_duration_ms: getElapsedMs(state.startedAt),
          server_duration_ms: Number(payload.report.durationMs) || 0,
          ...linkTimings,
        });
      })
      .catch(() => {});
    scheduleHistoryReportSave(payload.report);
    scheduleReportSdkRuleDetailHydration(payload.report);
    trackWebEvent("webui.link_analysis.succeeded", {
      result: "success",
      input_source: "url",
      client_duration_ms: getElapsedMs(state.startedAt),
      server_duration_ms: Number(payload.report.durationMs) || 0,
      duration_ms: Number(payload.report.durationMs) || 0,
      ...linkTimings,
      range_request_count: Number(payload.source?.stats?.rangeRequestCount) || 0,
      downloaded_bytes: Number(payload.source?.stats?.downloadedBytes) || 0,
      ...getReportAnalyticsFields(payload.report),
    });
  } catch (error) {
    if (error?.name === "AbortError" || !state.jobs.has(jobId)) {
      return;
    }

    state.jobs.delete(jobId);
    state.activeAnalyzeJobId = null;
    state.linkAbortController = null;
    state.linkStatusKey = "linkFailed";
    renderLinkStatus();
    finishAnalysis();
    showProgress("progressFailed");
    showError(getErrorMessage(error) || t("unknownError"));
    trackWebEvent("webui.link_analysis.failed", {
      result: "error",
      input_source: "url",
      client_duration_ms: getElapsedMs(state.startedAt),
      ...linkTimings,
      ...getClientErrorTelemetryFields(error),
    });
  }
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
      runtime.compareController?.finishJob(job.slotKey, null, message);
    } else {
      finishAnalysis();
      state.activeAnalyzeJobId = null;
      showProgress("progressFailed");
      showError(message);
      trackWebEvent("webui.analysis.failed", {
        result: "worker_error",
        error_name: "AnalyzerWorkerError",
      });
    }
  }
}

/** @param {MessageEvent<AnalyzerWorkerResponse>} event */
function handleWorkerMessage(event) {
  const message = event.data || {};
  if (!isAnalyzerWorkerMessage(message)) {
    return;
  }

  const job = state.jobs.get(message.jobId);
  if (!job) {
    return;
  }

  if (message.type === "progress") {
    if (job.type === "compare") {
      runtime.compareController?.handleProgress(
        job.slotKey,
        message.jobId,
        message.stage === "parsing" ? "progressParsing" : "progressReading",
      );
    } else {
      showProgress(message.stage === "parsing" ? "progressParsing" : "progressReading", {
        progress: Number.isFinite(message.progress) ? message.progress : undefined,
      });
    }
    return;
  }

  if (message.type === "error") {
    state.jobs.delete(message.jobId);
    scheduleWorkerIdleTermination();
    if (job.type === "compare") {
      runtime.compareController?.finishJob(job.slotKey, null, message.error || t("workerFailed"));
    } else {
      finishAnalysis();
      state.activeAnalyzeJobId = null;
      showProgress("progressFailed");
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
      runtime.compareController?.finishJob(job.slotKey, message.report, "");
      scheduleHistoryReportSave(message.report);
      scheduleWorkerIdleTermination();
      return;
    }

    finishAnalysis();
    state.activeAnalyzeJobId = null;
    state.report = message.report;
    state.activeNativeAbi = "";
    updateClearButton();
    showProgress("progressDone");
    renderReport();
    scheduleHistoryReportSave(message.report);
    scheduleReportSdkRuleDetailHydration(message.report);
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
  state.analyzeBusy = Boolean(isBusy);
  updateAnalyzeControls();
  if (elements.analyzeButtonLabel) {
    elements.analyzeButtonLabel.textContent = isBusy ? t("analyzing") : t("analyze");
  }
}

function updateAnalyzeControls() {
  const hasDownloadUrl = Boolean(state.downloadUrl);
  const hasSource = Boolean(state.selectedFile || hasDownloadUrl);
  elements.analyzeButton.disabled = state.analyzeBusy || !hasSource;
  elements.fileInput.disabled = state.analyzeBusy;
  elements.dropZone.classList.toggle("is-disabled", state.analyzeBusy);
  if (elements.linkInput) {
    elements.linkInput.disabled = state.analyzeBusy;
  }
  if (elements.linkClearButton) {
    elements.linkClearButton.disabled = state.analyzeBusy || !hasDownloadUrl;
  }
  if (elements.linkSubmitButton) {
    elements.linkSubmitButton.disabled = state.analyzeBusy || !hasDownloadUrl;
  }
}

function showProgress(key, options = {}) {
  elements.progress.hidden = false;
  elements.progress.classList.toggle("is-complete", key === "progressDone");
  elements.progress.classList.toggle("is-failed", key === "progressFailed");
  if (key === "progressDone") {
    setProgressValue(1);
  } else if (key === "progressFailed") {
    clearProgressValue();
  } else if (Number.isFinite(options.progress)) {
    setProgressValue(options.progress);
  } else {
    clearProgressValue();
  }
  elements.progressLabel.textContent = t(key);
  updateElapsed();
}

function setProgressValue(value) {
  const progressValue = clamp(Number(value), 0, 1);
  const wasDeterminate = state.progressValue != null;
  state.progressValue = progressValue;
  if (elements.progressBar) {
    const progressBar = elements.progressBar;
    const transition = isAppPowerConstrained() ? "none" : PROGRESS_WIDTH_TRANSITION;
    progressBar.style.animation = "none";

    if (wasDeterminate) {
      progressBar.style.transition = transition;
      progressBar.style.width = `${(progressValue * 100).toFixed(1)}%`;
    } else {
      progressBar.style.transition = "none";
      progressBar.style.width = `${(progressValue * 100).toFixed(1)}%`;
      if (transition !== "none") {
        progressBar.getBoundingClientRect();
        progressBar.style.transition = transition;
      }
    }
  }
  elements.progress.setAttribute("role", "progressbar");
  elements.progress.setAttribute("aria-valuemin", "0");
  elements.progress.setAttribute("aria-valuemax", "100");
  elements.progress.setAttribute("aria-valuenow", String(Math.round(progressValue * 100)));
}

function clearProgressValue() {
  state.progressValue = null;
  if (elements.progressBar) {
    elements.progressBar.style.removeProperty("transition");
    elements.progressBar.style.removeProperty("width");
    elements.progressBar.style.removeProperty("animation");
  }
  elements.progress.removeAttribute("role");
  elements.progress.removeAttribute("aria-valuemin");
  elements.progress.removeAttribute("aria-valuemax");
  elements.progress.removeAttribute("aria-valuenow");
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
  const progressText = state.progressValue == null || elements.progress.classList.contains("is-failed")
    ? ""
    : ` · ${Math.round(state.progressValue * 100)}%`;
  const text = `${elapsed.toFixed(1)}s${progressText}`;
  if (elements.progressTime.textContent !== text) {
    elements.progressTime.textContent = text;
  }
}

function resetProgressView() {
  elements.progress.hidden = true;
  elements.progress.classList.remove("is-complete", "is-failed");
  clearProgressValue();
  elements.progressTime.textContent = "0.0s";
  elements.progressLabel.textContent = t("progressReady");
}

async function openRuntimeLogModal() {
  try {
    await ensureRuntimeLogStyles();
  } catch (error) {
    appendRuntimeLog("warn", "webui.runtime_log.styles_failed", {
      error_name: getErrorName(error),
    });
  }

  state.runtimeLogOpen = true;
  elements.runtimeLogModal.hidden = false;
  renderRuntimeLogs();
  window.setTimeout(() => {
    elements.runtimeLogPanel?.focus();
  }, 0);
}

function ensureRuntimeLogStyles() {
  if (!runtime.runtimeLogStylesPromise) {
    runtime.runtimeLogStylesPromise = import("./runtime-log.css");
  }
  return runtime.runtimeLogStylesPromise;
}

function closeRuntimeLogModal() {
  state.runtimeLogOpen = false;
  elements.runtimeLogModal.hidden = true;
  elements.runtimeLogOpen?.focus();
}

function renderRuntimeLogs() {
  if (!elements.runtimeLogList) {
    return;
  }

  if (state.runtimeLogs.length === 0) {
    elements.runtimeLogList.innerHTML = `<div class="runtime-log-empty">${escapeHtml(t("runtimeLogEmpty"))}</div>`;
    return;
  }

  elements.runtimeLogList.innerHTML = state.runtimeLogs.map(renderRuntimeLogLine).join("");
  elements.runtimeLogList.scrollTop = elements.runtimeLogList.scrollHeight;
}

function renderRuntimeLogLine(entry) {
  const level = RUNTIME_LOG_LEVELS.has(entry.level) ? entry.level : "info";
  const date = new Date(entry.time || Date.now());
  const time = date.toLocaleTimeString(state.locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const details = entry.details
    ? `<span class="runtime-log-line__details">${escapeHtml(entry.details)}</span>`
    : "";

  return [
    `<div class="runtime-log-line" data-level="${escapeAttr(level)}">`,
    `<span class="runtime-log-line__time">${escapeHtml(time)}</span>`,
    `<span class="runtime-log-line__level">${escapeHtml(level.toUpperCase())}</span>`,
    `<span class="runtime-log-line__message">${escapeHtml(entry.message)}</span>`,
    details,
    `</div>`,
  ].join("");
}

async function exportRuntimeLogs() {
  if (!elements.runtimeLogExport) {
    return;
  }

  const text = buildRuntimeLogExportText();
  const fileName = `apk-webui-runtime-logs-${formatRuntimeLogExportTimestamp(new Date())}.log`;
  elements.runtimeLogExport.disabled = true;

  try {
    const file = typeof File === "function"
      ? new File([text], fileName, { type: "text/plain;charset=UTF-8" })
      : null;

    if (file && navigator.share && canShareRuntimeLogFile(file)) {
      await navigator.share({
        title: RUNTIME_LOG_EXPORT_TITLE,
        files: [file],
      });
      trackWebEvent("webui.runtime_log.exported", {
        result: "success",
        operation: "share_file",
        value: state.runtimeLogs.length,
      });
      return;
    }

    if (navigator.share) {
      await navigator.share({
        title: RUNTIME_LOG_EXPORT_TITLE,
        text,
      });
      trackWebEvent("webui.runtime_log.exported", {
        result: "success",
        operation: "share_text",
        value: state.runtimeLogs.length,
      });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      trackWebEvent("webui.runtime_log.export_cancelled", {
        result: "cancelled",
        operation: "share",
        value: state.runtimeLogs.length,
      });
      return;
    }
  } finally {
    elements.runtimeLogExport.disabled = false;
  }

  downloadRuntimeLogFile(fileName, text);
  trackWebEvent("webui.runtime_log.exported", {
    result: "success",
    operation: "download",
    value: state.runtimeLogs.length,
  });
}

function canShareRuntimeLogFile(file) {
  if (typeof navigator.canShare !== "function") {
    return false;
  }

  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function buildRuntimeLogExportText() {
  const lines = [
    RUNTIME_LOG_EXPORT_TITLE,
    `Version: ${APP_VERSION}`,
    `Locale: ${state.locale}`,
    `Exported At: ${new Date().toISOString()}`,
    `Entries: ${state.runtimeLogs.length}`,
    "",
  ];

  for (const entry of state.runtimeLogs) {
    lines.push(formatRuntimeLogExportLine(entry));
  }

  return lines.join("\n");
}

function formatRuntimeLogExportLine(entry) {
  const level = RUNTIME_LOG_LEVELS.has(entry.level) ? entry.level : "info";
  const time = new Date(entry.time || Date.now()).toISOString();
  const details = entry.details ? ` ${entry.details}` : "";
  return `[${time}] ${level.toUpperCase()} ${entry.message}${details}`;
}

function formatRuntimeLogExportTimestamp(date) {
  return date.toISOString().replace(/[:.]/gu, "-");
}

function downloadRuntimeLogFile(fileName, text) {
  const blob = new Blob([text], { type: "text/plain;charset=UTF-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function resetState() {
  const hadContent = Boolean(state.selectedFile || state.downloadUrl || state.report || state.activeAnalyzeJobId != null);
  cancelLcappsReportActivation();
  clearLcappsBubbleTransitionTimer();
  state.linkAbortController?.abort();
  state.linkAbortController = null;
  if (state.activeAnalyzeJobId != null) {
    state.jobs.delete(state.activeAnalyzeJobId);
    state.activeAnalyzeJobId = null;
  }
  scheduleWorkerIdleTermination();
  stopTimer();
  hideError();
  state.selectedFile = null;
  state.downloadUrl = "";
  state.linkStatusKey = "linkIdle";
  state.report = null;
  state.lcappsArchive = null;
  state.lcappsPicker.open = false;
  state.lcappsPicker.loading = false;
  state.lcappsPicker.error = "";
  state.lcappsPicker.query = "";
  state.lcappsPicker.selectedReport = null;
  runtime.lcappsPickerToken += 1;
  state.activeTab = "summary";
  state.activeNativeAbi = "";
  elements.fileInput.value = "";
  if (elements.linkInput) {
    elements.linkInput.value = "";
  }
  if (elements.lcappsSearch) {
    elements.lcappsSearch.value = "";
  }
  finishLcappsPickerClose();
  resetProgressView();
  state.analyzeBusy = false;
  renderSelectedFile();
  renderLinkStatus();
  updateAnalyzeControls();
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

function normalizeDownloadUrl(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid URL protocol");
  }
  url.hash = "";
  return url.toString();
}

function updateUrlReportProgress(progressEvent) {
  const stage = String(progressEvent?.stage || "");
  const key = URL_REPORT_PROGRESS_KEYS[stage] || "progressDownloading";
  const progressValue = Number.isFinite(progressEvent?.progress)
    ? Math.max(progressEvent.progress, state.progressValue ?? 0)
    : undefined;
  showProgress(key, {
    progress: progressValue,
  });
}

async function parseUrlReportResponse(response, timings = null, onProgress = () => {}) {
  const contentType = response.headers.get("content-type") || "";
  if (response.body && contentType.includes("application/x-ndjson")) {
    return parseStreamingUrlReportResponse(response, timings, onProgress);
  }

  return parseJsonResponse(response, timings);
}

async function parseStreamingUrlReportResponse(response, timings = null, onProgress = () => {}) {
  const textStartedAt = performance.now();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendingText = "";
  let payload = null;
  let bodyBytes = 0;
  let parseMs = 0;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const parseStartedAt = performance.now();
    let event;
    try {
      event = JSON.parse(trimmed);
    } finally {
      parseMs += performance.now() - parseStartedAt;
    }

    if (event?.type === "progress") {
      onProgress(event);
      return;
    }

    if (event?.type === "result") {
      payload = event.payload || null;
      return;
    }

    if (event?.type === "error") {
      throw createUrlReportError({ error: event.error || {} }, {
        status: Number(event.httpStatus) || response.status || 422,
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value?.byteLength) {
      continue;
    }

    bodyBytes += value.byteLength;
    pendingText += decoder.decode(value, { stream: true });
    let lineBreakIndex = pendingText.indexOf("\n");
    while (lineBreakIndex >= 0) {
      handleLine(pendingText.slice(0, lineBreakIndex));
      pendingText = pendingText.slice(lineBreakIndex + 1);
      lineBreakIndex = pendingText.indexOf("\n");
    }
  }

  pendingText += decoder.decode();
  handleLine(pendingText);

  if (timings) {
    timings.response_text_ms = getElapsedMs(textStartedAt);
    timings.body_bytes = bodyBytes;
    timings.json_parse_ms = Math.max(0, Math.round(parseMs));
  }

  return payload;
}

async function parseJsonResponse(response, timings = null) {
  const textStartedAt = performance.now();
  const text = await response.text();
  if (timings) {
    timings.response_text_ms = getElapsedMs(textStartedAt);
    timings.body_bytes = new Blob([text]).size;
  }
  if (!text) {
    return null;
  }

  const parseStartedAt = performance.now();
  try {
    const payload = JSON.parse(text);
    if (timings) {
      timings.json_parse_ms = getElapsedMs(parseStartedAt);
    }
    return payload;
  } catch {
    if (timings) {
      timings.json_parse_ms = getElapsedMs(parseStartedAt);
    }
    return null;
  }
}

function getElapsedMs(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function getResponseErrorMessage(payload, response) {
  const message = payload?.error?.message || payload?.message || "";
  if (message) {
    return String(message);
  }

  return response.status ? `${t("unknownError")} (${response.status})` : t("unknownError");
}

function createUrlReportError(payload, response) {
  const errorPayload = payload?.error || {};
  const error = new Error(getResponseErrorMessage(payload, response));
  error.name = String(errorPayload.name || "UrlReportError");
  error.code = typeof errorPayload.code === "string" ? errorPayload.code : "";
  error.logMessage = typeof errorPayload.logMessage === "string" ? errorPayload.logMessage : "";
  error.details = isPlainObject(errorPayload.details) ? errorPayload.details : {};
  error.httpStatus = response.status || 0;
  return error;
}

function getClientErrorTelemetryFields(error) {
  const details = isPlainObject(error?.details) ? error.details : {};
  return {
    error_name: getErrorName(error),
    error_code: getErrorCode(error),
    error_message: getErrorLogMessage(error),
    http_status: Number(error?.httpStatus) || 0,
    remote_package_type: details.remote_package_type || "",
    selected_apk_entry: details.selected_apk_entry || "",
    selected_apk_compression: details.selected_apk_compression || "",
    apk_entry_count: Number(details.apk_entry_count) || 0,
    top_level_zip_entry_count: Number(details.top_level_zip_entry_count) || 0,
    range_request_count: Number(details.range_request_count) || 0,
    range_cache_hit_count: Number(details.range_cache_hit_count) || 0,
    downloaded_bytes: Number(details.downloaded_bytes) || 0,
  };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "";
}

function getErrorName(error) {
  return error instanceof Error ? (error.name || "Error") : "UnknownError";
}

function getErrorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string" ? error.code : "";
}

function getErrorLogMessage(error) {
  if (error && typeof error === "object" && typeof error.logMessage === "string" && error.logMessage) {
    return error.logMessage;
  }

  return getErrorMessage(error);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function scheduleHistoryReportSave(report) {
  if (!report) {
    return;
  }

  runtime.pendingHistoryReports.push(report);
  if (runtime.historySaveHandle) {
    return;
  }

  if (typeof window.requestIdleCallback === "function") {
    runtime.historySaveHandleType = "idle";
    runtime.historySaveHandle = window.requestIdleCallback(flushScheduledHistoryReports, {
      timeout: HISTORY_SAVE_IDLE_TIMEOUT_MS,
    });
    return;
  }

  runtime.historySaveHandleType = "timeout";
  runtime.historySaveHandle = window.setTimeout(flushScheduledHistoryReports, HISTORY_SAVE_IDLE_TIMEOUT_MS);
}

function flushScheduledHistoryReports() {
  runtime.historySaveHandle = 0;
  runtime.historySaveHandleType = "";
  if (runtime.pendingHistoryReports.length === 0) {
    return;
  }

  const reports = runtime.pendingHistoryReports.splice(0);
  for (const report of reports) {
    saveHistoryReport(report);
  }
}

function cancelScheduledHistoryReports() {
  if (runtime.historySaveHandle) {
    if (runtime.historySaveHandleType === "idle" && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(runtime.historySaveHandle);
    } else {
      window.clearTimeout(runtime.historySaveHandle);
    }
  }

  runtime.historySaveHandle = 0;
  runtime.historySaveHandleType = "";
  runtime.pendingHistoryReports = [];
}

async function openHistoryItem(id) {
  if (state.loadingHistoryId) {
    return;
  }

  const entry = state.history.find((item) => item.id === id);
  if (!entry?.report) {
    return;
  }

  const token = runtime.historyOpenToken + 1;
  runtime.historyOpenToken = token;
  setHistoryLoadingId(id);
  hideError();
  stopTimer();
  preloadReportRenderer();
  preloadReportPreviewInteractions();

  try {
    const report = await hydrateReportSdkIconsForHistory(cloneReportForHydration(entry.report));
    if (token !== runtime.historyOpenToken) {
      return;
    }

    state.report = report;
    state.activeTab = "summary";
    state.activeNativeAbi = "";
    resetProgressView();
    updateClearButton();
    renderReport();
    trackWebEvent("webui.history.opened", {
      result: "success",
      input_source: "history",
      ...getReportAnalyticsFields(state.report),
    });
  } catch (error) {
    if (token !== runtime.historyOpenToken) {
      return;
    }

    showError(getErrorMessage(error) || t("unknownError"));
    trackWebEvent("webui.history.open_failed", {
      result: "error",
      error_name: getErrorName(error),
      input_source: "history",
    });
  } finally {
    if (token === runtime.historyOpenToken) {
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

  cancelScheduledHistoryReports();
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

function setHistoryViewMode(viewMode, options = {}) {
  const previousMode = state.historyViewMode;
  const normalizedMode = viewMode === "grid" ? "grid" : "list";
  state.historyViewMode = normalizedMode;
  renderHistoryViewMode();

  if (options.persist === false) {
    return;
  }

  persistHistoryViewMode(normalizedMode);
  if (previousMode !== normalizedMode) {
    trackWebEvent("webui.history.view_changed", {
      result: "success",
      operation: normalizedMode,
    });
  }
}

function renderHistoryViewMode() {
  const viewMode = state.historyViewMode === "grid" ? "grid" : "list";
  elements.historyList.classList.toggle("is-grid", viewMode === "grid");
  elements.historyList.classList.toggle("is-list", viewMode !== "grid");

  elements.historyViewButtons.forEach((button) => {
    const isActive = button.dataset.historyViewMode === viewMode;
    button.classList.toggle("is-active", isActive);
    button.classList.remove("is-pending");
    button.setAttribute("aria-checked", isActive ? "true" : "false");
  });
  updateHistoryViewIndicator(viewMode);
}

function updateHistoryViewIndicator(viewMode = state.historyViewMode) {
  runtime.pendingHistoryViewMode = viewMode === "grid" ? "grid" : "list";
  if (runtime.historyViewIndicatorFrame || !elements.historyViewGroup) {
    return;
  }

  runtime.historyViewIndicatorFrame = window.requestAnimationFrame(() => {
    runtime.historyViewIndicatorFrame = 0;
    const indicatorViewMode = runtime.pendingHistoryViewMode || state.historyViewMode;
    const activeButton = elements.historyViewButtons.find((button) => button.dataset.historyViewMode === indicatorViewMode);
    if (!activeButton || !elements.historyViewGroup) {
      return;
    }

    const groupRect = elements.historyViewGroup.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setSegmentIndicatorGeometry(elements.historyViewGroup, groupRect, buttonRect, "history-view");
  });
}

function clearHistoryViewPendingButtons() {
  elements.historyViewButtons.forEach((button) => {
    button.classList.remove("is-pending");
  });
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
  const file = summary.fileName || t("unknown");
  const size = formatBytes(summary.fileSizeBytes || 0);
  const date = formatDate(summary.analyzedAt || entry.savedAt);
  const stats = summary.stats || {};
  const versionBadges = [
    historyBadge(t("historyVersionName"), summary.versionName || t("unknown"), "history-badge--version-name"),
    historyBadge(t("historyVersionCode"), summary.versionCode || t("unknown"), "history-badge--version-code"),
    historyBadge(t("targetSdk"), summary.targetSdk || t("unknown"), "history-badge--target-sdk"),
  ].join("");
  const statItems = [
    historyStat(t("sdk"), summary.sdkCount || 0),
    historyStat(t("nativeLibraries"), stats.nativeLibraries || 0),
    historyStat(t("components"), stats.components || 0),
  ].join("");

  return [
    `<article class="history-row${isLoading ? " is-loading" : ""}" aria-busy="${isLoading ? "true" : "false"}">`,
    `<button class="history-main" type="button" data-history-action="open" data-history-id="${escapeAttr(entry.id)}" aria-label="${escapeAttr(t("historyOpen"))}" aria-disabled="${isHistoryLoading ? "true" : "false"}">`,
    icon,
    `<span class="history-copy">`,
    `<span class="history-title">${escapeHtml(title)}</span>`,
    `<span class="history-package">${escapeHtml(packageName)}</span>`,
    `<span class="history-badges">${versionBadges}</span>`,
    `<span class="history-stats">${statItems}</span>`,
    `<span class="history-file-line">`,
    `<span>${escapeHtml(file)}</span>`,
    `<span aria-hidden="true">·</span>`,
    `<span>${escapeHtml(size)}</span>`,
    `<span aria-hidden="true">·</span>`,
    `<span>${escapeHtml(date)}</span>`,
    `</span>`,
    `<span class="history-loading" aria-live="polite">`,
    renderHistoryLoadingSpinner(),
    `<span>${escapeHtml(t("historyOpening"))}</span>`,
    `</span>`,
    `</span>`,
    `</button>`,
    `<button class="icon-button history-delete" type="button" data-history-action="delete" data-history-id="${escapeAttr(entry.id)}" aria-label="${escapeAttr(t("historyDelete"))}" title="${escapeAttr(t("historyDelete"))}" aria-disabled="${isHistoryLoading ? "true" : "false"}">`,
    `<svg viewBox="0 0 24 24" aria-hidden="true">`,
    `<path d="M3 6h18"></path>`,
    `<path d="M8 6V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V6"></path>`,
    `<path d="M6.5 6.5 7.2 19a2 2 0 0 0 2 1.9h5.6a2 2 0 0 0 2-1.9l.7-12.5"></path>`,
    `<path d="M10 10v6"></path>`,
    `<path d="M14 10v6"></path>`,
    `</svg>`,
    `</button>`,
    `</article>`,
  ].join("");
}

function renderHistoryLoadingSpinner() {
  return [
    `<svg class="history-loading-spinner" viewBox="63 63 250 250" aria-hidden="true" focusable="false">`,
    `<path d="${BRAND_LOGO_FOREGROUND_PATH}"></path>`,
    `</svg>`,
  ].join("");
}

function historyBadge(label, value, className = "") {
  const badgeClass = className ? `history-badge ${className}` : "history-badge";
  return [
    `<span class="${escapeAttr(badgeClass)}">`,
    `<span class="history-badge-label">${escapeHtml(label)}</span>`,
    `<span class="history-badge-value">${escapeHtml(String(value || t("unknown")))}</span>`,
    `</span>`,
  ].join("");
}

function historyStat(label, value) {
  return [
    `<span class="history-stat">`,
    `<span class="history-stat-value">${escapeHtml(String(value ?? 0))}</span>`,
    `<span class="history-stat-label">${escapeHtml(label)}</span>`,
    `</span>`,
  ].join("");
}

function renderHistoryIcon(summary) {
  const src = sanitizeImageSrc(summary.iconDataUri || "");
  if (src) {
    return `<img class="history-icon" src="${escapeAttr(src)}" alt="${escapeAttr(summary.appName || t("appName"))}">`;
  }

  return `<span class="history-icon history-icon-placeholder" aria-hidden="true">${escapeHtml(getInitial(summary.appName || summary.packageName))}</span>`;
}

async function renderReport() {
  const renderToken = runtime.reportRenderToken + 1;
  runtime.reportRenderToken = renderToken;

  if (state.appMode !== "analyze") {
    hideAnalyzeReportViews(elements);
    return;
  }

  if (!state.report) {
    showEmptyReportState(elements);
    return;
  }

  preloadReportPreviewInteractions();
  let reportRenderer = null;
  try {
    await loadSdkIconRendererModule();
    reportRenderer = await loadReportRendererModule();
  } catch (error) {
    if (renderToken !== runtime.reportRenderToken) {
      return;
    }

    console.error("Failed to load SDK icon renderer", error);
    showError(t("workerFailed"));
    return;
  }

  if (renderToken !== runtime.reportRenderToken || state.appMode !== "analyze" || !state.report) {
    return;
  }

  const archiveDistribution = reportRenderer.renderArchiveDistribution(state.report);
  showReportState(elements, {
    heroHtml: reportRenderer.renderHero(state.report),
    archiveDistributionHtml: archiveDistribution,
  });
  initReportTitleColorMask(elements.reportHero, state.report.apkInfo);
  updateTabs();
  renderTabPanel();
}

function updateTabs() {
  updateTabButtonsView(elements, state.activeTab);
  clearTabPendingButtons();
  updateTabIndicator();
}

function renderTabPanel() {
  const report = state.report;
  if (!report) {
    return;
  }

  if (!runtime.sdkIconRendererModule || !runtime.reportRendererModule) {
    void renderReport();
    return;
  }

  setTabPanelHtml(elements, runtime.reportRendererModule.renderTabPanelHtml(report));
}

function emptyList(message) {
  return `<p class="empty-list">${escapeHtml(message)}</p>`;
}

async function openLcappsPickerForFile(file) {
  if (!file) {
    return;
  }

  try {
    await ensureLcappsBubbleStyles();
  } catch (error) {
    trackWebEvent("webui.lcapps.styles_failed", {
      result: "error",
      error_name: getErrorName(error),
      file_kind: "lcapps",
    });
  }
  cancelLcappsReportActivation();
  const token = runtime.lcappsPickerToken + 1;
  runtime.lcappsPickerToken = token;
  state.lcappsArchive = null;
  state.lcappsPicker.open = true;
  state.lcappsPicker.loading = true;
  state.lcappsPicker.error = "";
  state.lcappsPicker.query = "";
  state.lcappsPicker.selectedReport = null;
  if (elements.lcappsSearch) {
    elements.lcappsSearch.value = "";
  }
  renderLcappsBubble();
  showLcappsPicker();
  renderLcappsPicker();
  trackWebEvent("webui.lcapps.opened", {
    result: "started",
    input_source: "upload",
    file_kind: "lcapps",
    ...getFileAnalyticsFields(file),
  });

  try {
    const { readLcappsArchive } = await loadLcappsReaderModule();
    const archive = await readLcappsArchive(file, {
      locale: state.locale,
      nowIso: new Date().toISOString(),
    });
    if (runtime.lcappsPickerToken !== token) {
      return;
    }

    state.lcappsArchive = archive;
    state.lcappsPicker.loading = false;
    state.lcappsPicker.error = "";
    renderLcappsPicker();
    focusLcappsPicker();
    trackWebEvent("webui.lcapps.loaded", {
      result: "success",
      input_source: "upload",
      file_kind: "lcapps",
      value: archive.reports.length,
      ...getFileAnalyticsFields(file),
    });
  } catch (error) {
    if (runtime.lcappsPickerToken !== token) {
      return;
    }

    state.lcappsPicker.loading = false;
    state.lcappsPicker.error = getLcappsErrorMessage(error);
    renderLcappsPicker();
    focusLcappsPicker();
    trackWebEvent("webui.lcapps.failed", {
      result: "error",
      input_source: "upload",
      file_kind: "lcapps",
      error_name: getErrorName(error),
      ...getFileAnalyticsFields(file),
    });
  }
}

function ensureLcappsBubbleStyles() {
  if (!runtime.lcappsBubbleStylesPromise) {
    runtime.lcappsBubbleStylesPromise = import("./lcapps-bubble.css");
  }
  return runtime.lcappsBubbleStylesPromise;
}

function reopenLcappsPicker() {
  if (!state.lcappsArchive) {
    return;
  }

  cancelLcappsReportActivation();
  clearLcappsBubbleTransitionTimer();
  hideLcappsBubble();
  state.lcappsPicker.open = true;
  state.lcappsPicker.loading = false;
  state.lcappsPicker.error = "";
  showLcappsPicker();
  renderLcappsPicker();
  focusLcappsPicker();
  trackWebEvent("webui.lcapps.reopened", {
    result: "success",
    input_source: "bubble",
    value: state.lcappsArchive.reports.length,
  });
}

function showLcappsPicker() {
  if (!elements.lcappsPicker) {
    return;
  }

  clearLcappsBubbleTransitionTimer();
  hideLcappsBubble();
  elements.lcappsPicker.hidden = false;
  elements.lcappsPicker.classList.add("is-open");
  elements.lcappsPickerPanel?.classList.add("is-visible");
  document.documentElement.classList.add("has-lcapps-picker");
  ensureRulePreviewMaterial();
  if (elements.lcappsPickerPanel) {
    updateLiquidGlassFilterForPreview(elements.lcappsPickerPanel);
  }
}

function focusLcappsPicker() {
  window.requestAnimationFrame(() => {
    elements.lcappsSearch?.focus({ preventScroll: true });
    if (document.activeElement !== elements.lcappsSearch) {
      elements.lcappsPickerPanel?.focus({ preventScroll: true });
    }
  });
}

function closeLcappsPicker(options = {}) {
  if (!elements.lcappsPicker || elements.lcappsPicker.hidden) {
    return;
  }

  state.lcappsPicker.open = false;
  runtime.lcappsPickerToken += 1;
  document.documentElement.classList.remove("has-lcapps-picker");
  finishLcappsPickerClose({ renderBubble: false });
  renderLcappsBubble({ bounce: options.bounceBubble });
}

function finishLcappsPickerClose(options = {}) {
  elements.lcappsPicker?.classList.remove("is-open");
  elements.lcappsPickerPanel?.classList.remove("is-visible");
  if (elements.lcappsPicker) {
    elements.lcappsPicker.hidden = true;
  }
  if (options.renderBubble !== false) {
    renderLcappsBubble();
  }
}

function renderLcappsPicker() {
  if (!elements.lcappsPicker || !elements.lcappsPickerPanel) {
    return;
  }

  const archive = state.lcappsArchive;
  const loading = state.lcappsPicker.loading;
  const error = state.lcappsPicker.error;
  const query = state.lcappsPicker.query.trim();
  const totalCount = archive?.reports.length || 0;
  const matches = archive ? getFilteredLcappsReports(archive.reports, query) : [];

  elements.lcappsPickerSubtitle.textContent = loading
    ? t("lcappsLoading")
    : archive
      ? t("lcappsSubtitle", { count: totalCount, name: archive.fileName || t("unknown") })
      : t("lcappsSubtitle", { count: 0, name: t("unknown") });

  if (elements.lcappsSearch && elements.lcappsSearch.value !== state.lcappsPicker.query) {
    elements.lcappsSearch.value = state.lcappsPicker.query;
  }
  if (elements.lcappsSearch) {
    elements.lcappsSearch.disabled = loading || Boolean(error) || !archive;
  }

  if (loading) {
    elements.lcappsStatus.hidden = false;
    elements.lcappsStatus.innerHTML = renderLcappsStatus(t("lcappsLoading"), true);
    elements.lcappsGrid.innerHTML = "";
    return;
  }

  if (error) {
    elements.lcappsStatus.hidden = false;
    elements.lcappsStatus.innerHTML = renderLcappsStatus(error, false, "error");
    elements.lcappsGrid.innerHTML = "";
    return;
  }

  if (!archive) {
    elements.lcappsStatus.hidden = false;
    elements.lcappsStatus.innerHTML = renderLcappsStatus(t("lcappsEmpty"), false);
    elements.lcappsGrid.innerHTML = "";
    return;
  }

  if (matches.length === 0) {
    elements.lcappsStatus.hidden = false;
    elements.lcappsStatus.innerHTML = renderLcappsStatus(t("lcappsNoMatches"), false);
    elements.lcappsGrid.innerHTML = "";
    return;
  }

  elements.lcappsStatus.hidden = true;
  elements.lcappsStatus.innerHTML = "";
  elements.lcappsGrid.innerHTML = matches.map(({ report, index }) => renderLcappsAppCard(report, index)).join("");
}

function renderLcappsStatus(message, busy, tone = "") {
  return [
    `<div class="lcapps-status-card${tone ? ` lcapps-status-card--${escapeAttr(tone)}` : ""}"${busy ? ` aria-busy="true"` : ""}>`,
    busy ? `<span class="lcapps-spinner" aria-hidden="true"></span>` : "",
    `<span>${escapeHtml(message)}</span>`,
    `</div>`,
  ].join("");
}

function getFilteredLcappsReports(reports, query) {
  const normalizedQuery = query.toLowerCase();
  return reports
    .map((report, index) => ({ report, index }))
    .filter(({ report }) => {
      if (!normalizedQuery) {
        return true;
      }

      const info = report.apkInfo || {};
      return [
        info.appName,
        info.packageName,
        info.versionName,
        info.versionCode,
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    });
}

function renderLcappsAppCard(report, index) {
  const info = report.apkInfo || {};
  const title = info.appName || info.packageName || t("unknown");
  const packageName = info.packageName || t("unknown");
  const version = info.versionName || t("unknown");
  const targetSdk = info.targetSdk || t("unknown");
  const stats = getStats(info);
  const meta = [
    `${t("versionName")}: ${version}`,
    `${t("targetSdk")}: ${targetSdk}`,
  ].join(" · ");
  const subMeta = [
    `${t("sdk")}: ${(info.sdkSummary?.native?.length || 0) + (info.sdkSummary?.components?.length || 0)}`,
    `${t("components")}: ${stats.components}`,
    `${t("permissions")}: ${stats.permissions}`,
  ].join(" · ");

  return [
    `<button class="lcapps-app-card" type="button" data-lcapps-index="${escapeAttr(index)}">`,
    renderLcappsAppIcon(info, "lcapps-app-icon"),
    `<span class="lcapps-app-copy">`,
    `<span class="lcapps-app-title">${escapeHtml(title)}</span>`,
    `<span class="lcapps-app-package">${escapeHtml(packageName)}</span>`,
    `<span class="lcapps-app-meta">${escapeHtml(meta)}</span>`,
    `<span class="lcapps-app-meta">${escapeHtml(subMeta)}</span>`,
    `</span>`,
    `</button>`,
  ].join("");
}

function renderLcappsAppIcon(info, className) {
  const src = sanitizeImageSrc(info.icon?.dataUri || "");
  const label = info.appName || info.packageName || t("appName");
  if (src) {
    return `<img class="${escapeAttr(className)}" src="${escapeAttr(src)}" alt="${escapeAttr(label)}">`;
  }

  return `<span class="${escapeAttr(`${className} ${className}--placeholder`)}" aria-hidden="true">${escapeHtml(getInitial(label))}</span>`;
}

async function selectLcappsReport(index) {
  const archive = state.lcappsArchive;
  const sourceReport = archive?.reports[index];
  if (!sourceReport) {
    return;
  }

  clearLcappsReportActivationTimer();
  const token = runtime.lcappsReportActivationToken + 1;
  runtime.lcappsReportActivationToken = token;
  const report = cloneReportForHydration(sourceReport);
  state.lcappsPicker.selectedReport = report;
  closeLcappsPicker({ bounceBubble: true });
  scheduleLcappsReportActivation(report, token);
}

function scheduleLcappsReportActivation(report, token) {
  void activateSelectedLcappsReport(report, token);
}

function cancelLcappsReportActivation() {
  clearLcappsReportActivationTimer();
  runtime.lcappsReportActivationToken += 1;
}

function clearLcappsReportActivationTimer() {
  if (!runtime.lcappsReportActivationTimer) {
    return;
  }

  window.clearTimeout(runtime.lcappsReportActivationTimer);
  runtime.lcappsReportActivationTimer = 0;
}

function clearLcappsBubbleTransitionTimer() {
  if (!runtime.lcappsBubbleTransitionTimer) {
    return;
  }

  window.clearTimeout(runtime.lcappsBubbleTransitionTimer);
  runtime.lcappsBubbleTransitionTimer = 0;
}

function hideLcappsBubble() {
  if (!elements.lcappsBubble || !elements.lcappsBubbleContent) {
    return;
  }

  elements.lcappsBubble.classList.remove("is-bouncing");
  elements.lcappsBubble.hidden = true;
  elements.lcappsBubbleContent.innerHTML = "";
}

async function activateSelectedLcappsReport(report, token) {
  if (runtime.lcappsReportActivationToken !== token || state.lcappsPicker.selectedReport !== report) {
    return;
  }

  state.startedAt = performance.now();
  setBusy(true);
  showProgress("progressParsing");
  startTimer();

  try {
    await annotateLcappsReportSdkMarkers(report);
  } catch (error) {
    if (runtime.lcappsReportActivationToken !== token || state.lcappsPicker.selectedReport !== report) {
      return;
    }

    finishAnalysis();
    showError(getErrorMessage(error) || t("workerFailed"));
    trackWebEvent("webui.lcapps.sdk_annotation_failed", {
      result: "error",
      input_source: "lcapps",
      file_kind: "lcapps",
      error_name: getErrorName(error),
      ...getReportAnalyticsFields(report),
    });
    return;
  }

  if (runtime.lcappsReportActivationToken !== token || state.lcappsPicker.selectedReport !== report) {
    return;
  }

  activateLcappsReport(report);
  try {
    await hydrateReportSdkIconsForHistory(report);
    if (state.report !== report) {
      return;
    }

    runtime.reportRendererModule?.clearExportJsonCache(report);
    renderReport();
    scheduleReportSdkRuleDetailHydration(report);
  } catch {
    scheduleReportSdkRuleDetailHydration(report);
  }
}

async function annotateLcappsReportSdkMarkers(report) {
  const { annotateLcappsReportSdkMarkers: annotateReport } = await loadLcappsSdkAnnotationModule();
  return annotateReport(report);
}

function activateLcappsReport(report) {
  if (state.activeAnalyzeJobId != null) {
    state.jobs.delete(state.activeAnalyzeJobId);
    state.activeAnalyzeJobId = null;
  }
  scheduleWorkerIdleTermination();
  finishAnalysis();
  hideError();
  state.report = report;
  state.activeTab = "summary";
  state.activeNativeAbi = "";
  resetProgressView();
  updateClearButton();
  renderReport();
  renderLcappsBubble();
  scheduleHistoryReportSave(report);
  trackWebEvent("webui.lcapps.selected", {
    result: "success",
    input_source: "lcapps",
    file_kind: "lcapps",
    ...getReportAnalyticsFields(report),
  });
}

function renderLcappsBubble(options = {}) {
  if (!elements.lcappsBubble || !elements.lcappsBubbleContent) {
    return;
  }

  const report = state.lcappsPicker.selectedReport;
  if (!report || state.lcappsPicker.open) {
    hideLcappsBubble();
    return;
  }

  const info = report.apkInfo || {};
  const title = info.appName || info.packageName || t("unknown");
  elements.lcappsBubble.hidden = false;
  elements.lcappsBubble.setAttribute("aria-label", t("lcappsReopenWithApp", { app: title }));
  elements.lcappsBubble.title = t("lcappsReopen");
  elements.lcappsBubbleContent.innerHTML = renderLcappsAppIcon(info, "lcapps-bubble-icon");
  if (options.bounce && !hasReducedMotionPreference()) {
    elements.lcappsBubble.classList.remove("is-bouncing");
    void elements.lcappsBubble.offsetWidth;
    elements.lcappsBubble.classList.add("is-bouncing");
    runtime.lcappsBubbleTransitionTimer = window.setTimeout(() => {
      runtime.lcappsBubbleTransitionTimer = 0;
      elements.lcappsBubble?.classList.remove("is-bouncing");
    }, LCAPPS_BUBBLE_BOUNCE_MS + 40);
  }
  ensureRulePreviewMaterial();
  updateLiquidGlassFilterForPreview(elements.lcappsBubble);
}

function getLcappsErrorMessage(error) {
  const key = String(error?.code || error?.message || "");
  const supportedKeys = new Set([
    "unsupportedDecompression",
    "lcappsInvalidZip",
    "lcappsUnsupportedZip64",
    "lcappsMissingJson",
    "lcappsInvalidJson",
    "lcappsUnsupportedCompression",
    "lcappsEmpty",
  ]);
  return supportedKeys.has(key) ? t(key) : t("lcappsReadFailed");
}


function isLikelyApk(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return (
    [".apk", ".apks", ".apkm", ".xapk"].some((extension) => name.endsWith(extension)) ||
    type.includes("android.package-archive")
  );
}

function isLikelyLcapps(file) {
  return String(file?.name || "").toLowerCase().endsWith(".lcapps");
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
