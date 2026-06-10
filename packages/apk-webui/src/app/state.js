export const VALID_TABS = new Set(["summary", "sdk", "native", "components", "permissions", "signatures", "metadata", "raw"]);
export const VALID_APP_MODES = new Set(["analyze", "compare"]);
export const THEME_STORAGE_KEY = "apk-webui-theme";
export const THEME_CHOICES = new Set(["light", "dark", "system"]);
export const WORKER_IDLE_TERMINATE_MS = 60_000;
export const ANALYTICS_EVENT_QUEUE_LIMIT = 32;

export function createAppState({ locale, themeChoice, history, historyCollapsed }) {
  return {
    appMode: "analyze",
    locale,
    themeChoice,
    selectedFile: null,
    report: null,
    history,
    historyCollapsed,
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
}

export function createThemeDragState() {
  return {
    active: false,
    pointerId: null,
    pendingChoice: "",
    suppressClick: false,
    buttonCenters: [],
  };
}

export function createModeDragState() {
  return {
    active: false,
    pointerId: null,
    pendingMode: "",
    suppressClick: false,
    buttonCenters: [],
  };
}

export function createRuntimeState() {
  return {
    historyOpenToken: 0,
    modeIndicatorFrame: 0,
    pendingModeIndicatorAppMode: "",
    themeIndicatorFrame: 0,
    pendingThemeIndicatorChoice: "",
    compareController: null,
    compareControllerPromise: null,
    rulePreviewMaterialCapabilityChecked: false,
    rulePreviewMaterialCapabilitySupported: false,
    rulePreviewMaterialWarmupScheduled: false,
    powerModeInitialized: false,
    powerConstrained: false,
    powerModeMediaQueries: [],
    powerModeBattery: null,
    liquidGlassFilterSignature: "",
    liquidGlassMapCache: new Map(),
    liquidGlassMapPrewarmScheduled: false,
    terminalSystemDetectorPromise: null,
    brandTitleColorMaskPromise: null,
    appTitleColorMaskPromise: null,
    reportSdkMetadataModulePromise: null,
    reportSdkMetadataHydrationToken: 0,
    analyticsModule: null,
    analyticsModulePromise: null,
    analyticsContextProvider: () => ({}),
    analyticsInitialized: false,
    analyticsLoadScheduled: false,
  };
}

export const pointerCoordinateUpdaters = new WeakMap();
export const dateTimeFormatters = new Map();
export const exportJsonCache = new WeakMap();
export const pendingAnalyticsEvents = [];
