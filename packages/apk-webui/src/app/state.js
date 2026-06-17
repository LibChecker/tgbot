export const VALID_TABS = new Set(["summary", "sdk", "native", "components", "permissions", "signatures", "metadata", "raw"]);
export const VALID_APP_MODES = new Set(["analyze", "compare"]);
export const THEME_STORAGE_KEY = "apk-webui-theme";
export const THEME_CHOICES = new Set(["light", "dark", "system"]);
export const WORKER_IDLE_TERMINATE_MS = 60_000;
export const ANALYTICS_EVENT_QUEUE_LIMIT = 32;

export function createAppState({ locale, themeChoice, history, historyCollapsed, historyViewMode }) {
  return {
    appMode: "analyze",
    locale,
    themeChoice,
    selectedFile: null,
    downloadUrl: "",
    linkStatusKey: "linkIdle",
    runtimeLogs: [],
    runtimeLogOpen: false,
    report: null,
    lcappsArchive: null,
    lcappsPicker: {
      open: false,
      loading: false,
      error: "",
      query: "",
      selectedReport: null,
    },
    history,
    historyCollapsed,
    historyViewMode,
    activeTab: "summary",
    activeNativeAbi: "",
    loadingHistoryId: "",
    worker: null,
    workerIdleTimer: null,
    linkAbortController: null,
    jobs: new Map(),
    jobId: 0,
    activeAnalyzeJobId: null,
    analyzeBusy: false,
    startedAt: 0,
    timer: null,
    progressValue: null,
  };
}

export function createThemeDragState() {
  return {
    active: false,
    dragging: false,
    scrolling: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    scrollStartLeft: 0,
    startedOnActiveSegment: false,
    pendingChoice: "",
    suppressClick: false,
    buttonCenters: [],
  };
}

export function createModeDragState() {
  return {
    active: false,
    dragging: false,
    scrolling: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    scrollStartLeft: 0,
    startedOnActiveSegment: false,
    pendingMode: "",
    suppressClick: false,
    buttonCenters: [],
  };
}

export function createHistoryViewDragState() {
  return {
    active: false,
    dragging: false,
    scrolling: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    scrollStartLeft: 0,
    startedOnActiveSegment: false,
    pendingViewMode: "",
    suppressClick: false,
    buttonCenters: [],
  };
}

export function createReportTabDragState() {
  return {
    active: false,
    dragging: false,
    scrolling: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    scrollStartLeft: 0,
    startedOnActiveSegment: false,
    pendingTab: "",
    suppressClick: false,
    buttonCenters: [],
  };
}

export function createRuntimeState() {
  return {
    historyOpenToken: 0,
    historySaveHandle: 0,
    historySaveHandleType: "",
    pendingHistoryReports: [],
    runtimeLogId: 0,
    runtimeLogStylesPromise: null,
    lcappsBubbleStylesPromise: null,
    analyzePanelHeightAnimation: null,
    modeIndicatorFrame: 0,
    pendingModeIndicatorAppMode: "",
    themeIndicatorFrame: 0,
    themeTransitionFrame: 0,
    pendingThemeIndicatorChoice: "",
    historyViewIndicatorFrame: 0,
    pendingHistoryViewMode: "",
    tabIndicatorFrame: 0,
    pendingTabIndicatorTab: "",
    reportRenderToken: 0,
    reportRevealToken: 0,
    compareController: null,
    compareControllerPromise: null,
    rulePreviewMaterialCapabilityChecked: false,
    rulePreviewMaterialCapabilitySupported: false,
    rulePreviewMaterialFallbackReason: "",
    rulePreviewMaterialWarmupScheduled: false,
    powerModeInitialized: false,
    powerConstrained: false,
    powerModeMediaQueries: [],
    powerModeBattery: null,
    liquidGlassFilterSignature: "",
    liquidGlassMapCache: new Map(),
    liquidGlassMapPrewarmScheduled: false,
    terminalSystemDetectorPromise: null,
    appTitleColorMaskPromise: null,
    topbarIdentityMode: "brand",
    topbarIdentityKey: "",
    topbarIdentityFrame: 0,
    topbarActionsShiftToken: 0,
    lcappsReaderModulePromise: null,
    sdkIconRendererModule: null,
    sdkIconRendererModulePromise: null,
    reportRendererModule: null,
    reportRendererModulePromise: null,
    reportSdkMetadataModulePromise: null,
    reportPreviewInteractionsPromise: null,
    lcappsSdkAnnotationModulePromise: null,
    reportSdkMetadataHydrationToken: 0,
    lcappsPickerToken: 0,
    lcappsReportActivationToken: 0,
    lcappsBubbleTransitionTimer: 0,
    lcappsReportActivationTimer: 0,
    analyticsModule: null,
    analyticsModulePromise: null,
    analyticsContextProvider: () => ({}),
    analyticsInitialized: false,
    analyticsLoadScheduled: false,
  };
}

export const pointerCoordinateUpdaters = new WeakMap();
export const dateTimeFormatters = new Map();
export const pendingAnalyticsEvents = [];
