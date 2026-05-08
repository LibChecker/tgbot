const I18N = {
  "zh-CN": {
    title: "LibChecker WebUI",
    subtitle: "在线分析 APK",
    themeLabel: "主题",
    themeDark: "深色",
    themeLight: "浅色",
    themeSystem: "系统",
    languageLabel: "语言",
    exportJson: "导出 JSON",
    clear: "清空",
    filePrompt: "选择或拖入 APK",
    fileIdle: "未选择文件",
    localNote: "文件只在当前浏览器中解析。",
    analyze: "开始分析",
    analyzing: "分析中",
    progressReady: "等待文件",
    progressReading: "读取 APK",
    progressParsing: "解析 Manifest、资源与 DEX 标记",
    progressDone: "分析完成",
    historyTitle: "历史记录",
    historyNote: "保存在当前浏览器中，点击记录可重新打开结果。",
    historyEmpty: "还没有历史记录。",
    historyOpen: "打开历史记录",
    historyDelete: "删除",
    historyExpand: "展开历史",
    historyCollapse: "收起历史",
    clearHistory: "清空历史",
    historyItemMeta: "{version} · Target SDK {targetSdk}",
    historyFileMeta: "{file} · {size} · {date}",
    emptyTitle: "等待 APK",
    emptyBody: "分析完成后会在这里展示摘要、SDK 标记、组件、权限和 meta-data。",
    tabSummary: "摘要",
    tabSdk: "SDK",
    tabNative: "原生库",
    tabComponents: "组件",
    tabPermissions: "权限",
    tabMeta: "Meta-Data",
    tabRaw: "JSON",
    noFile: "请选择一个 APK 文件。",
    invalidFile: "请上传 .apk 文件。",
    workerFailed: "分析进程启动失败。",
    appName: "应用名",
    packageName: "包名",
    versionName: "versionName",
    versionCode: "versionCode",
    targetSdk: "Target SDK",
    minSdk: "Min SDK",
    compileSdk: "Compile SDK",
    fileName: "文件名",
    fileSize: "文件大小",
    analyzedAt: "分析时间",
    duration: "耗时",
    terminalSystem: "终端系统",
    permissions: "权限",
    nativeLibraries: "原生库",
    components: "组件",
    metaData: "Meta-Data",
    buildFeatures: "构建特性",
    noBuildFeatures: "未识别到构建特性。",
    noNativeLibraries: "未发现原生库。",
    noSdkMarkers: "未匹配到 SDK 标记。",
    noComponents: "未声明组件。",
    noPermissions: "未声明权限。",
    noMetaData: "未声明 application 级 meta-data。",
    summary: "摘要",
    sdkNative: "原生库 SDK 标记",
    sdkComponents: "组件 SDK 标记",
    activities: "Activity",
    services: "Service",
    receivers: "Receiver",
    providers: "Provider",
    exported: "exported",
    notExported: "not exported",
    enabled: "enabled",
    disabled: "disabled",
    unknown: "未知",
    permission: "权限",
    process: "进程",
    authorities: "authorities",
    actions: "actions",
    targetActivity: "targetActivity",
    sdk: "SDK",
    abi: "ABI",
    path: "路径",
    size: "大小",
    value: "值",
    resource: "资源",
    rawNotice: "JSON 视图默认省略较大的 data URI；导出文件也使用同样结构。",
    selectedFile: "{name} · {size}",
    completedIn: "{seconds}s",
    localFile: "本地文件",
  },
  en: {
    title: "LibChecker WebUI",
    subtitle: "APK Analyzer in Browser",
    themeLabel: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    themeSystem: "System",
    languageLabel: "Language",
    exportJson: "Export JSON",
    clear: "Clear",
    filePrompt: "Choose or drop an APK",
    fileIdle: "No file selected",
    localNote: "The file is analyzed in this browser.",
    analyze: "Analyze",
    analyzing: "Analyzing",
    progressReady: "Waiting for file",
    progressReading: "Reading APK",
    progressParsing: "Parsing manifest, resources, and DEX markers",
    progressDone: "Analysis complete",
    historyTitle: "History",
    historyNote: "Saved in this browser. Click an item to reopen the report.",
    historyEmpty: "No history yet.",
    historyOpen: "Open history item",
    historyDelete: "Delete",
    historyExpand: "Expand History",
    historyCollapse: "Collapse History",
    clearHistory: "Clear History",
    historyItemMeta: "{version} · Target SDK {targetSdk}",
    historyFileMeta: "{file} · {size} · {date}",
    emptyTitle: "Waiting for APK",
    emptyBody: "The report will show summary, SDK markers, components, permissions, and meta-data.",
    tabSummary: "Summary",
    tabSdk: "SDK",
    tabNative: "Native",
    tabComponents: "Components",
    tabPermissions: "Permissions",
    tabMeta: "Meta-Data",
    tabRaw: "JSON",
    noFile: "Choose an APK file.",
    invalidFile: "Please upload a .apk file.",
    workerFailed: "Failed to start the analyzer worker.",
    appName: "App Name",
    packageName: "Package Name",
    versionName: "versionName",
    versionCode: "versionCode",
    targetSdk: "Target SDK",
    minSdk: "Min SDK",
    compileSdk: "Compile SDK",
    fileName: "File Name",
    fileSize: "File Size",
    analyzedAt: "Analyzed At",
    duration: "Duration",
    terminalSystem: "Terminal System",
    permissions: "Permissions",
    nativeLibraries: "Native Libraries",
    components: "Components",
    metaData: "Meta-Data",
    buildFeatures: "Build Features",
    noBuildFeatures: "No build features detected.",
    noNativeLibraries: "No native libraries found.",
    noSdkMarkers: "No SDK markers matched.",
    noComponents: "No components declared.",
    noPermissions: "No permissions declared.",
    noMetaData: "No application-level meta-data declared.",
    summary: "Summary",
    sdkNative: "Native Library SDK Markers",
    sdkComponents: "Component SDK Markers",
    activities: "Activity",
    services: "Service",
    receivers: "Receiver",
    providers: "Provider",
    exported: "exported",
    notExported: "not exported",
    enabled: "enabled",
    disabled: "disabled",
    unknown: "Unknown",
    permission: "Permission",
    process: "Process",
    authorities: "authorities",
    actions: "actions",
    targetActivity: "targetActivity",
    sdk: "SDK",
    abi: "ABI",
    path: "Path",
    size: "Size",
    value: "Value",
    resource: "Resource",
    rawNotice: "The JSON view omits large data URIs by default. Export uses the same structure.",
    selectedFile: "{name} · {size}",
    completedIn: "{seconds}s",
    localFile: "Local file",
  },
};

const COMPONENT_SECTIONS = ["activities", "services", "receivers", "providers"];
const VALID_TABS = new Set(["summary", "sdk", "native", "components", "permissions", "metadata", "raw"]);
const THEME_STORAGE_KEY = "apk-webui-theme";
const THEME_CHOICES = new Set(["light", "dark", "system"]);
const HISTORY_STORAGE_KEY = "apk-webui-history";
const HISTORY_COLLAPSED_STORAGE_KEY = "apk-webui-history-collapsed";
const MAX_HISTORY_ITEMS = 12;
const HISTORY_MAX_APP_ICON_DATA_URI_LENGTH = 180_000;
const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
let sdkIconSvgMap = null;
let sdkIconSvgMapPromise = null;
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

const state = {
  locale: normalizeLocale(navigator.language),
  themeChoice: readThemeChoice(),
  selectedFile: null,
  report: null,
  history: readHistory(),
  historyCollapsed: readHistoryCollapsed(),
  activeTab: "summary",
  worker: null,
  jobId: 0,
  startedAt: 0,
  timer: null,
};

const elements = {
  themeButtons: [...document.querySelectorAll("[data-theme-choice]")],
  languageSelect: document.querySelector("#language-select"),
  exportButton: document.querySelector("#export-button"),
  clearButton: document.querySelector("#clear-button"),
  brandTitle: document.querySelector(".brand-title"),
  form: document.querySelector("#analyze-form"),
  fileInput: document.querySelector("#file-input"),
  fileMeta: document.querySelector("#file-meta"),
  dropZone: document.querySelector("#drop-zone"),
  analyzeButton: document.querySelector("#analyze-button"),
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
  tabs: document.querySelector("#tabs"),
  tabPanel: document.querySelector("#tab-panel"),
};

applyThemeChoice(state.themeChoice, { persist: false });
elements.languageSelect.value = state.locale;
applyLocale();
renderBrandTitle();
renderHistoryList();
updateHistoryCollapse();
bindEvents();
initBrandWave();

function bindEvents() {
  elements.themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyThemeChoice(button.dataset.themeChoice);
    });
  });

  systemThemeMedia.addEventListener("change", () => {
    if (state.themeChoice === "system") {
      applyThemeChoice("system", { persist: false });
    }
  });

  elements.languageSelect.addEventListener("change", () => {
    state.locale = normalizeLocale(elements.languageSelect.value);
    applyLocale();
    updateHistoryCollapse();
    renderSelectedFile();
    renderHistoryList();
    renderReport();
  });

  elements.fileInput.addEventListener("change", () => {
    setSelectedFile(elements.fileInput.files?.[0] || null);
  });

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

  elements.exportButton.addEventListener("click", () => {
    if (state.report) {
      downloadReport(state.report);
    }
  });

  elements.clearButton.addEventListener("click", () => {
    resetState();
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

    const id = button.dataset.historyId;
    if (button.dataset.historyAction === "open") {
      openHistoryItem(id);
    } else if (button.dataset.historyAction === "delete") {
      deleteHistoryItem(id);
    }
  });

  elements.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]")?.dataset.tab;
    if (!tab || !VALID_TABS.has(tab)) {
      return;
    }

    state.activeTab = tab;
    updateTabs();
    renderTabPanel();
  });
}

function initBrandWave() {
  const wave = document.querySelector(".brand-wave");
  const path = document.querySelector(".brand-wave__path");
  if (!wave || !path) {
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frameId = 0;
  let lastTime = 0;
  let phase = 0;
  let isPressing = false;
  let pressStart = 0;
  let lastPointerEventAt = 0;
  let lastPressEnd = 0;
  let waveLevel = 0;
  let releasePulse = 0;

  const setWave = (level) => {
    const amplitude = 2.15 + level * 7.4;
    const radius = 28.9 + level * 1.9;
    path.setAttribute("d", buildBrandWavePath({ amplitude, phase, radius }));
    path.style.opacity = (0.14 + level * 0.18).toFixed(2);
  };

  const tick = (now) => {
    const delta = lastTime ? Math.min(now - lastTime, 50) : 16.7;
    lastTime = now;

    const heldLevel = isPressing ? Math.min((now - pressStart) / 1400, 1) : 0;
    const targetLevel = Math.max(heldLevel, releasePulse);
    waveLevel = lerp(waveLevel, targetLevel, 0.085);
    if (!isPressing) {
      releasePulse *= Math.pow(0.925, delta / 16.7);
    }

    phase += delta * (0.0022 + waveLevel * 0.0042);
    setWave(waveLevel);
    frameId = window.requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!frameId) {
      return;
    }

    window.cancelAnimationFrame(frameId);
    frameId = 0;
  };

  const start = () => {
    if (reducedMotion.matches) {
      setWave(0);
      return;
    }

    if (frameId) {
      return;
    }

    lastTime = 0;
    frameId = window.requestAnimationFrame(tick);
  };

  const beginPress = (now) => {
    if (isPressing) {
      return;
    }

    isPressing = true;
    pressStart = now;
    waveLevel = Math.max(waveLevel, 0.08);
    releasePulse = Math.max(releasePulse, 0.18);
    setWave(waveLevel);
  };

  const endPress = (now) => {
    if (!isPressing) {
      return;
    }

    const heldFor = now - pressStart;
    releasePulse = Math.max(releasePulse, Math.min(heldFor / 1400, 1));
    isPressing = false;
    lastPressEnd = now;
    setWave(Math.max(waveLevel, releasePulse));
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    lastPointerEventAt = performance.now();
    beginPress(lastPointerEventAt);
  };

  const onPointerUp = () => {
    lastPointerEventAt = performance.now();
    endPress(lastPointerEventAt);
  };

  const onMouseDown = (event) => {
    if (event.button !== 0 || performance.now() - lastPointerEventAt < 80) {
      return;
    }

    beginPress(performance.now());
  };

  const onMouseUp = () => {
    if (performance.now() - lastPointerEventAt < 80) {
      return;
    }

    endPress(performance.now());
  };

  const onClick = () => {
    const now = performance.now();
    if (now - lastPressEnd > 80) {
      waveLevel = Math.max(waveLevel, 0.16);
      releasePulse = Math.max(releasePulse, 0.28);
      setWave(Math.max(waveLevel, releasePulse));
    }
  };

  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("pointerleave", onPointerUp);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("click", onClick);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("click", onClick, true);

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      stop();
      setWave(0);
      return;
    }

    start();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
      return;
    }

    start();
  });

  setWave(0);
  start();
}

function buildBrandWavePath({ amplitude, phase, radius }) {
  const center = 36;
  const points = [];
  const pointCount = 54;

  for (let index = 0; index < pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    const wave =
      Math.sin(angle * 3 + phase) * amplitude * 0.64 +
      Math.sin(angle * 5 - phase * 0.72 + 1.15) * amplitude * 0.28 +
      Math.sin(angle * 2 + phase * 0.43 + 2.4) * amplitude * 0.22;
    const pointRadius = radius + wave;
    points.push({
      x: center + Math.cos(angle) * pointRadius,
      y: center + Math.sin(angle) * pointRadius,
    });
  }

  return buildClosedSmoothPath(points);
}

function buildClosedSmoothPath(points) {
  const count = points.length;
  let path = `M ${formatPoint(points[0])}`;

  for (let index = 0; index < count; index += 1) {
    const previous = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const afterNext = points[(index + 2) % count];
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6,
    };
    path += ` C ${formatPoint(controlOne)} ${formatPoint(controlTwo)} ${formatPoint(next)}`;
  }

  return `${path} Z`;
}

function formatPoint(point) {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
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
  const themeChoice = THEME_CHOICES.has(choice) ? choice : "system";
  const shouldPersist = options.persist !== false;
  state.themeChoice = themeChoice;

  document.documentElement.dataset.themeChoice = themeChoice;
  document.documentElement.dataset.colorScheme = resolveColorScheme(themeChoice);

  elements.themeButtons.forEach((button) => {
    const isActive = button.dataset.themeChoice === themeChoice;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-checked", isActive ? "true" : "false");
  });

  if (!shouldPersist) {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeChoice);
  } catch {
    // Theme persistence is optional; the UI still reflects the current choice.
  }
}

function resolveColorScheme(choice) {
  if (choice === "dark" || choice === "light") {
    return choice;
  }

  return systemThemeMedia.matches ? "dark" : "light";
}

function renderBrandTitle() {
  const node = elements.brandTitle;
  if (!node) {
    return;
  }

  const title = node.dataset.dotTitle || t("title");
  node.textContent = "";
  node.classList.add("is-dot-rendered");
  node.setAttribute("aria-label", title);

  title.split(" ").forEach((word) => {
    if (!word) {
      return;
    }

    const wordNode = document.createElement("span");
    wordNode.className = "brand-title__word";
    wordNode.setAttribute("aria-hidden", "true");

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

    node.append(wordNode);
  });
}

function applyLocale() {
  document.documentElement.lang = state.locale === "en" ? "en" : "zh-CN";
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

function setSelectedFile(file) {
  hideError();
  state.selectedFile = file;
  renderSelectedFile();
  elements.analyzeButton.disabled = !file;
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
    return;
  }

  if (!isLikelyApk(file)) {
    showError(t("invalidFile"));
    return;
  }

  const worker = ensureWorker();
  if (!worker) {
    showError(t("workerFailed"));
    return;
  }

  state.jobId += 1;
  state.startedAt = performance.now();
  state.report = null;
  state.activeTab = "summary";

  setBusy(true);
  showProgress("progressReading");
  startTimer();

  const jobId = state.jobId;
  const terminalSystem = await detectTerminalSystem();

  if (jobId !== state.jobId) {
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
  if (state.worker) {
    return state.worker;
  }

  try {
    const worker = new Worker(new URL("./analyzer-worker.js", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => {
      finishAnalysis();
      showError(event.message || t("workerFailed"));
    });
    state.worker = worker;
    return worker;
  } catch {
    return null;
  }
}

function handleWorkerMessage(event) {
  const message = event.data || {};
  if (message.jobId !== state.jobId) {
    return;
  }

  if (message.type === "progress") {
    showProgress(message.stage === "parsing" ? "progressParsing" : "progressReading");
    return;
  }

  if (message.type === "error") {
    finishAnalysis();
    showError(message.error || t("workerFailed"));
    return;
  }

  if (message.type === "result") {
    finishAnalysis();
    state.report = message.report;
    saveHistoryReport(message.report);
    elements.exportButton.disabled = false;
    elements.clearButton.disabled = false;
    showProgress("progressDone");
    renderReport();
  }
}

function finishAnalysis() {
  setBusy(false);
  stopTimer();
}

function setBusy(isBusy) {
  elements.analyzeButton.disabled = isBusy || !state.selectedFile;
  elements.analyzeButton.querySelector("span").textContent = isBusy ? t("analyzing") : t("analyze");
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
  elements.progressTime.textContent = `${elapsed.toFixed(1)}s`;
}

function resetState() {
  stopTimer();
  hideError();
  state.selectedFile = null;
  state.report = null;
  state.activeTab = "summary";
  elements.fileInput.value = "";
  elements.progress.hidden = true;
  elements.progress.classList.remove("is-complete");
  elements.progressTime.textContent = "0.0s";
  elements.progressLabel.textContent = t("progressReady");
  elements.exportButton.disabled = true;
  elements.clearButton.disabled = true;
  elements.analyzeButton.disabled = true;
  renderSelectedFile();
  renderReport();
}

function showError(message) {
  elements.errorBox.hidden = false;
  elements.errorBox.textContent = message;
}

function hideError() {
  elements.errorBox.hidden = true;
  elements.errorBox.textContent = "";
}

function saveHistoryReport(report) {
  const entry = createHistoryEntry(report);
  const nextHistory = [
    entry,
    ...state.history.filter((item) => item.key !== entry.key),
  ].slice(0, MAX_HISTORY_ITEMS);

  state.history = persistHistory(nextHistory);
  renderHistoryList();
}

async function openHistoryItem(id) {
  const entry = state.history.find((item) => item.id === id);
  if (!entry?.report) {
    return;
  }

  hideError();
  stopTimer();
  state.report = await hydrateReportSdkIcons(entry.report);
  state.activeTab = "summary";
  elements.progress.hidden = true;
  elements.progress.classList.remove("is-complete");
  elements.progressTime.textContent = "0.0s";
  elements.progressLabel.textContent = t("progressReady");
  elements.exportButton.disabled = false;
  elements.clearButton.disabled = false;
  renderReport();
}

function deleteHistoryItem(id) {
  state.history = persistHistory(state.history.filter((item) => item.id !== id));
  renderHistoryList();
}

function clearHistory() {
  state.history = persistHistory([]);
  renderHistoryList();
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

  try {
    window.localStorage.setItem(HISTORY_COLLAPSED_STORAGE_KEY, state.historyCollapsed ? "true" : "false");
  } catch {
    // The panel remains interactive even if the preference cannot be saved.
  }
}

function updateHistoryCollapse() {
  setHistoryCollapsed(state.historyCollapsed, { persist: false });
}

function renderHistoryList() {
  elements.clearHistoryButton.disabled = state.history.length === 0;

  if (state.history.length === 0) {
    elements.historyList.innerHTML = emptyList(t("historyEmpty"));
    return;
  }

  elements.historyList.innerHTML = state.history.map(renderHistoryItem).join("");
}

function renderHistoryItem(entry) {
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
    `<article class="history-row">`,
    `<button class="history-main" type="button" data-history-action="open" data-history-id="${escapeAttr(entry.id)}" aria-label="${escapeAttr(t("historyOpen"))}">`,
    icon,
    `<span class="history-copy">`,
    `<span class="history-title">${escapeHtml(title)}</span>`,
    `<span class="history-package">${escapeHtml(packageName)}</span>`,
    `<span class="history-meta">${escapeHtml(t("historyItemMeta", { version, targetSdk }))}</span>`,
    `<span class="history-meta">${escapeHtml(t("historyFileMeta", { file, size, date }))}</span>`,
    `<span class="history-meta">${escapeHtml(statText)}</span>`,
    `</span>`,
    `</button>`,
    `<button class="icon-button history-delete" type="button" data-history-action="delete" data-history-id="${escapeAttr(entry.id)}" aria-label="${escapeAttr(t("historyDelete"))}" title="${escapeAttr(t("historyDelete"))}">`,
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
  if (!state.report) {
    elements.emptyState.hidden = false;
    elements.resultView.hidden = true;
    elements.reportHero.innerHTML = "";
    elements.tabPanel.innerHTML = "";
    return;
  }

  elements.emptyState.hidden = true;
  elements.resultView.hidden = false;
  elements.reportHero.innerHTML = renderHero(state.report);
  updateTabs();
  renderTabPanel();
}

function updateTabs() {
  elements.tabs.querySelectorAll("[data-tab]").forEach((button) => {
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
    `<h2>${escapeHtml(info.appName || t("unknown"))}</h2>`,
    `<div class="hero-meta">`,
    chip(info.packageName || t("unknown")),
    chip(`${t("versionName")}: ${info.versionName || t("unknown")}`),
    chip(`${t("targetSdk")}: ${info.targetSdk || t("unknown")}`),
    chip(t("localFile")),
    `</div>`,
    `</div>`,
  ].join("");
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
  const blocks = [...groups.entries()].map(([abi, items]) => {
    const rows = items.map((library) => {
      const sdk = library.sdk ? renderSdkChip(library.sdk) : "";
      return [
        `<article class="list-row">`,
        `<div class="row-title"><span>${escapeHtml(library.name || t("unknown"))}</span></div>`,
        `<div class="row-meta">${escapeHtml(t("size"))}: ${escapeHtml(formatBytes(library.size || 0))}</div>`,
        `<div class="row-meta">${escapeHtml(t("path"))}: ${codeChip(library.path || "")}</div>`,
        sdk ? `<div class="row-meta">${escapeHtml(t("sdk"))}: ${sdk}</div>` : "",
        `</article>`,
      ].join("");
    }).join("");

    return [
      `<section class="group-block">`,
      `<h4>${escapeHtml(t("abi"))}: ${escapeHtml(abi)} <span class="muted">(${items.length})</span></h4>`,
      `<div class="list-stack">${rows}</div>`,
      `</section>`,
    ].join("");
  }).join("");

  return `<div class="group-grid">${blocks}</div>`;
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
      `<section class="group-block">`,
      `<h4>${escapeHtml(t(sectionName))} <span class="muted">(${items.length})</span></h4>`,
      rows ? `<div class="list-stack">${rows}</div>` : emptyList(t("noComponents")),
      `</section>`,
    ].join("");
  }).join("");

  return `<div class="group-grid">${blocks}</div>`;
}

function renderComponentRow(component) {
  const flags = [
    component.exported == null ? t("unknown") : component.exported ? t("exported") : t("notExported"),
    component.enabled == null ? "" : component.enabled ? t("enabled") : t("disabled"),
  ].filter(Boolean);
  const details = [
    component.permission ? `${t("permission")}: ${component.permission}` : "",
    component.process ? `${t("process")}: ${component.process}` : "",
    component.authorities ? `${t("authorities")}: ${component.authorities}` : "",
    component.targetActivity ? `${t("targetActivity")}: ${component.targetActivity}` : "",
    component.actions?.length ? `${t("actions")}: ${component.actions.join(", ")}` : "",
  ].filter(Boolean);

  return [
    `<article class="list-row">`,
    `<div class="row-title"><span>${escapeHtml(component.shortName || component.name || t("unknown"))}</span></div>`,
    `<div class="row-meta">${codeChip(component.name || t("unknown"))}</div>`,
    flags.length ? `<div class="row-meta">${escapeHtml(flags.join(" · "))}</div>` : "",
    details.map((item) => `<div class="row-meta">${escapeHtml(item)}</div>`).join(""),
    component.sdk ? `<div class="row-meta">${escapeHtml(t("sdk"))}: ${renderSdkChip(component.sdk)}</div>` : "",
    `</article>`,
  ].join("");
}

function renderPermissionsTab(report) {
  const permissions = report.apkInfo.permissions || [];
  if (permissions.length === 0) {
    return emptyList(t("noPermissions"));
  }

  return `<div class="chip-cloud">${permissions.map(codeChip).join("")}</div>`;
}

function renderMetaDataTab(report) {
  const metaData = report.apkInfo.metaData?.application || [];
  if (metaData.length === 0) {
    return emptyList(t("noMetaData"));
  }

  const rows = metaData.map((item) => [
    `<article class="list-row">`,
    `<div class="row-title"><span>${escapeHtml(item.name || t("unknown"))}</span></div>`,
    `<div class="row-meta">${escapeHtml(t("value"))}: ${escapeHtml(item.value || t("unknown"))}</div>`,
    item.resourceId != null ? `<div class="row-meta">${escapeHtml(t("resource"))}: ${codeChip(formatResourceId(item.resourceId))}</div>` : "",
    `</article>`,
  ].join("")).join("");

  return `<div class="list-stack">${rows}</div>`;
}

function renderRawTab(report) {
  return [
    `<p class="warning-note">${escapeHtml(t("rawNotice"))}</p>`,
    `<pre class="json-block">${escapeHtml(JSON.stringify(buildExportReport(report), null, 2))}</pre>`,
  ].join("");
}

function renderSdkSummaryPreview(sdkSummary) {
  if (!sdkSummary) {
    return emptyList(t("noSdkMarkers"));
  }

  const combined = [
    ...(sdkSummary.native || []).map((item) => ({ ...item, source: t("nativeLibraries") })),
    ...(sdkSummary.components || []).map((item) => ({ ...item, source: t("components") })),
  ].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  if (combined.length === 0) {
    return emptyList(t("noSdkMarkers"));
  }

  return renderSdkRows(combined.slice(0, 8));
}

function renderSdkRows(entries) {
  if (!entries.length) {
    return emptyList(t("noSdkMarkers"));
  }

  const max = Math.max(...entries.map((entry) => entry.count || 0), 1);
  const rows = entries.map((entry) => {
    const width = Math.max(4, Math.round(((entry.count || 0) / max) * 100));
    const preview = (entry.previewItems || []).map(codeChip).join("");
    const detailParts = [entry.source, entry.detail].filter(Boolean);
    return [
      `<article class="sdk-row">`,
      `<div class="sdk-row-header">`,
      `<div class="sdk-title">${renderSdkIcon(entry.iconUrl, entry.label)}<span>${escapeHtml(entry.label || t("unknown"))}</span></div>`,
      `<span class="sdk-count">${escapeHtml(String(entry.count || 0))}</span>`,
      `</div>`,
      `<div class="bar-track"><div class="bar" style="width: ${width}%"></div></div>`,
      detailParts.length ? `<div class="sdk-meta">${escapeHtml(detailParts.join(" · "))}</div>` : "",
      preview ? `<div class="sdk-preview">${preview}</div>` : "",
      `</article>`,
    ].join("");
  }).join("");

  return `<div class="sdk-stack">${rows}</div>`;
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

function renderAppIcon(info) {
  const src = sanitizeImageSrc(info.icon?.dataUri || "");
  if (src) {
    return `<img class="app-icon" src="${escapeAttr(src)}" alt="${escapeAttr(info.appName || t("appName"))}">`;
  }

  return `<div class="app-icon-placeholder" aria-hidden="true">${escapeHtml(getInitial(info.appName || info.packageName))}</div>`;
}

function renderSdkChip(sdk) {
  return `<span class="chip">${renderSdkIcon(sdk.iconUrl, sdk.label)}${escapeHtml(sdk.label || t("unknown"))}</span>`;
}

function renderSdkIcon(src, label) {
  const safeSrc = sanitizeImageSrc(src || "");
  if (!safeSrc) {
    return "";
  }

  return `<img class="sdk-icon" src="${escapeAttr(safeSrc)}" alt="${escapeAttr(label || "")}">`;
}

function renderKeyValueTable(rows) {
  return [
    `<div class="kv-table">`,
    rows.map(([label, value]) => [
      `<div class="kv-row">`,
      `<div class="kv-label">${escapeHtml(label)}</div>`,
      `<div class="kv-value">${escapeHtml(value || t("unknown"))}</div>`,
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

function emptyList(message) {
  return `<p class="empty-list">${escapeHtml(message)}</p>`;
}

function getStats(info) {
  return {
    permissions: info.permissions?.length || 0,
    nativeLibraries: info.nativeLibraries?.length || 0,
    components: countComponents(info.components),
    metaData: info.metaData?.application?.length || 0,
  };
}

function countComponents(components = {}) {
  return COMPONENT_SECTIONS.reduce((sum, key) => sum + (components[key]?.length || 0), 0);
}

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    const values = groups.get(key) || [];
    values.push(item);
    groups.set(key, values);
  }
  return groups;
}

function buildFeatureLabel(name, version) {
  return version ? `${name} ${version}` : name;
}

function isLikelyApk(file) {
  const name = String(file.name || "").toLowerCase();
  const type = String(file.type || "").toLowerCase();
  return name.endsWith(".apk") || type.includes("android.package-archive");
}

function downloadReport(report) {
  const data = JSON.stringify(buildExportReport(report), null, 2);
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

function createHistoryEntry(report) {
  const compactReport = compactReportForHistory(report, { keepAppIcon: true });
  const savedAt = new Date().toISOString();

  return {
    id: createHistoryId(),
    key: buildHistoryKey(report),
    savedAt,
    summary: buildHistorySummary(compactReport),
    report: compactReport,
  };
}

function buildHistorySummary(report) {
  const info = report.apkInfo || {};
  const sdkSummary = info.sdkSummary || {};
  const iconDataUri = sanitizeImageSrc(info.icon?.dataUri || "");

  return {
    appName: info.appName || "",
    packageName: info.packageName || "",
    versionName: info.versionName || "",
    versionCode: info.versionCode || "",
    targetSdk: info.targetSdk || "",
    fileName: report.fileName || "",
    fileSizeBytes: report.fileSizeBytes || 0,
    analyzedAt: report.analyzedAt || "",
    iconDataUri,
    sdkCount: (sdkSummary.native?.length || 0) + (sdkSummary.components?.length || 0),
    stats: getStats(info),
  };
}

function buildHistoryKey(report) {
  const info = report.apkInfo || {};
  return [
    info.packageName || "",
    info.versionCode || "",
    report.fileName || "",
    report.fileSizeBytes || "",
  ].join("::");
}

function createHistoryId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readHistory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeHistoryEntry).filter(Boolean).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function readHistoryCollapsed() {
  try {
    return window.localStorage.getItem(HISTORY_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.report || typeof entry.report !== "object") {
    return null;
  }

  const computedSummary = buildHistorySummary(entry.report);
  const providedSummary = entry.summary && typeof entry.summary === "object" ? entry.summary : {};

  return {
    id: String(entry.id || createHistoryId()),
    key: String(entry.key || buildHistoryKey(entry.report)),
    savedAt: String(entry.savedAt || entry.report.analyzedAt || new Date().toISOString()),
    summary: {
      ...computedSummary,
      ...providedSummary,
      iconDataUri: sanitizeImageSrc(providedSummary.iconDataUri || computedSummary.iconDataUri || ""),
      stats: {
        ...computedSummary.stats,
        ...(providedSummary.stats || {}),
      },
    },
    report: entry.report,
  };
}

function persistHistory(history) {
  const normalized = history.map(normalizeHistoryEntry).filter(Boolean).slice(0, MAX_HISTORY_ITEMS);
  const candidates = [
    normalized,
    normalized.slice(0, 8).map((entry) => compactHistoryEntry(entry, { keepAppIcon: true })),
    normalized.slice(0, 6).map((entry) => compactHistoryEntry(entry, { keepAppIcon: false })),
  ];

  for (const candidate of candidates) {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(candidate));
      return candidate;
    } catch {
      // Try a smaller representation below.
    }
  }

  return normalized;
}

function compactHistoryEntry(entry, options) {
  const report = compactReportForHistory(entry.report, options);
  const summary = buildHistorySummary(report);

  return {
    ...entry,
    summary,
    report,
  };
}

function compactReportForHistory(report, options = {}) {
  return compactHistoryValue(report, [], {
    keepAppIcon: options.keepAppIcon !== false,
  });
}

function compactHistoryValue(value, path, options) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => compactHistoryValue(entry, [...path, String(index)], options));
  }

  if (!value || typeof value !== "object") {
    if (typeof value !== "string" || !value.startsWith("data:image/")) {
      return value;
    }

    const isAppIcon = path.join(".") === "apkInfo.icon.dataUri";
    if (options.keepAppIcon && isAppIcon && value.length <= HISTORY_MAX_APP_ICON_DATA_URI_LENGTH) {
      return value;
    }

    return "";
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      compactHistoryValue(entry, [...path, key], options),
    ]),
  );
}

async function hydrateReportSdkIcons(report) {
  const iconMap = await loadSdkIconSvgMap();
  if (!Object.keys(iconMap).length) {
    return report;
  }

  const info = report.apkInfo || {};
  hydrateSdkIconList(info.sdkSummary?.native, iconMap);
  hydrateSdkIconList(info.sdkSummary?.components, iconMap);

  for (const library of info.nativeLibraries || []) {
    hydrateSdkIcon(library.sdk, iconMap);
  }

  for (const sectionName of COMPONENT_SECTIONS) {
    for (const component of info.components?.[sectionName] || []) {
      hydrateSdkIcon(component.sdk, iconMap);
    }
  }

  return report;
}

async function loadSdkIconSvgMap() {
  if (sdkIconSvgMap) {
    return sdkIconSvgMap;
  }

  if (!sdkIconSvgMapPromise) {
    sdkIconSvgMapPromise = import("./modules/generated/libchecker-sdk-icons.js")
      .then((module) => module.LIBCHECKER_SDK_ICON_SVGS || {})
      .catch(() => ({}));
  }

  sdkIconSvgMap = await sdkIconSvgMapPromise;
  return sdkIconSvgMap;
}

function hydrateSdkIconList(entries = [], iconMap) {
  for (const entry of entries) {
    hydrateSdkIcon(entry, iconMap);
  }
}

function hydrateSdkIcon(sdk, iconMap) {
  if (!sdk || typeof sdk !== "object" || sanitizeImageSrc(sdk.iconUrl || "")) {
    return;
  }

  sdk.iconUrl = resolveSdkIconDataUri(sdk.iconName, iconMap);
}

function resolveSdkIconDataUri(iconName, iconMap) {
  const svg = iconMap?.[iconName] || iconMap?.ic_sdk_placeholder;
  if (!svg) {
    return "";
  }

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function stripDataUris(value) {
  if (Array.isArray(value)) {
    return value.map(stripDataUris);
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.startsWith("data:image/")) {
      return `[omitted ${value.length} chars]`;
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "string" && entry.startsWith("data:image/")
        ? `[omitted ${entry.length} chars]`
        : stripDataUris(entry),
    ]),
  );
}

function formatDate(value) {
  if (!value) {
    return t("unknown");
  }

  try {
    return new Intl.DateTimeFormat(state.locale, {
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(2)} ${units[index]}`;
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

async function detectTerminalSystem() {
  const navigatorValue = window.navigator || {};
  const userAgentData = navigatorValue.userAgentData;

  if (userAgentData && typeof userAgentData.getHighEntropyValues === "function") {
    try {
      const values = await userAgentData.getHighEntropyValues(["platform", "platformVersion"]);
      const system = normalizeSystemPlatform(
        values.platform || userAgentData.platform || navigatorValue.platform,
        values.platformVersion,
      );

      if (system.name || system.version) {
        return {
          ...system,
          source: "userAgentData",
        };
      }
    } catch {
      // Fall back to the reduced user agent string.
    }
  }

  return parseSystemFromUserAgent(navigatorValue.userAgent, navigatorValue.platform);
}

function normalizeSystemPlatform(platform, version) {
  const platformText = String(platform || "").trim();
  const versionText = cleanSystemVersion(version);
  const platformKey = platformText.toLowerCase();

  if (!platformText) {
    return { name: "", version: versionText };
  }

  if (platformKey.includes("mac")) {
    return { name: "macOS", version: versionText };
  }

  if (platformKey.includes("win")) {
    return { name: "Windows", version: normalizeWindowsUaDataVersion(versionText) };
  }

  if (platformKey.includes("android")) {
    return { name: "Android", version: versionText };
  }

  if (platformKey.includes("ios")) {
    return { name: "iOS", version: versionText };
  }

  if (platformKey.includes("chrome os") || platformKey.includes("cros")) {
    return { name: "ChromeOS", version: versionText };
  }

  if (platformKey.includes("linux")) {
    return { name: "Linux", version: versionText };
  }

  return { name: platformText, version: versionText };
}

function parseSystemFromUserAgent(userAgent, platform = "") {
  const userAgentText = String(userAgent || "");
  const platformText = String(platform || "");
  const iosVersion = userAgentText.match(/(?:CPU(?: iPhone)? OS|iPhone OS)\s+([0-9_]+)/iu);
  const androidVersion = userAgentText.match(/Android\s+([0-9][0-9._]*)/iu);
  const chromeOsVersion = userAgentText.match(/CrOS\s+\S+\s+([0-9.]+)/iu);
  const macOsVersion = userAgentText.match(/Mac OS X\s+([0-9_]+)/iu);
  const windowsVersion = userAgentText.match(/Windows NT\s+([0-9.]+)/iu);

  if (/iPad/iu.test(platformText)) {
    return buildTerminalSystem("iPadOS", iosVersion?.[1]);
  }

  if (/iPhone|iPod/iu.test(platformText)) {
    return buildTerminalSystem("iOS", iosVersion?.[1]);
  }

  if (androidVersion) {
    return buildTerminalSystem("Android", androidVersion[1]);
  }

  if (chromeOsVersion) {
    return buildTerminalSystem("ChromeOS", chromeOsVersion[1]);
  }

  if (macOsVersion && /Mobile/iu.test(userAgentText)) {
    return buildTerminalSystem("iPadOS", iosVersion?.[1] || macOsVersion[1]);
  }

  if (macOsVersion) {
    return buildTerminalSystem("macOS", macOsVersion[1]);
  }

  if (windowsVersion) {
    return buildTerminalSystem("Windows", normalizeWindowsVersion(windowsVersion[1]));
  }

  if (/Linux/iu.test(userAgentText) || /Linux/iu.test(platformText)) {
    return buildTerminalSystem("Linux", "");
  }

  return buildTerminalSystem(platformText || "Unknown", "");
}

function buildTerminalSystem(name, version) {
  return {
    name: String(name || "Unknown").trim(),
    version: cleanSystemVersion(version),
    source: "userAgent",
  };
}

function cleanSystemVersion(value) {
  return String(value || "").trim().replaceAll("_", ".");
}

function normalizeWindowsVersion(value) {
  const version = cleanSystemVersion(value);
  const knownVersions = {
    "10.0": "10",
    "6.3": "8.1",
    "6.2": "8",
    "6.1": "7",
  };

  return knownVersions[version] || version;
}

function normalizeWindowsUaDataVersion(value) {
  const version = cleanSystemVersion(value);
  const major = Number.parseInt(version.split(".")[0], 10);

  if (major >= 13) {
    return "11";
  }

  if (major > 0) {
    return "10";
  }

  return version;
}

function formatResourceId(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return String(value);
  }

  return `0x${(numberValue >>> 0).toString(16).padStart(8, "0")}`;
}

function sanitizeFilePart(value) {
  return String(value || "apk-report").replaceAll(/[^a-z0-9._-]+/giu, "_").slice(0, 120) || "apk-report";
}

function sanitizeImageSrc(value) {
  const src = String(value || "");
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml)(?:;[a-z0-9=_-]+)*(?:;base64)?,/iu.test(src)) {
    return src;
  }

  return "";
}

function getInitial(value) {
  const normalized = String(value || "A").trim();
  return [...normalized][0]?.toUpperCase() || "A";
}

function normalizeLocale(value) {
  const locale = String(value || "").toLowerCase();
  return locale.startsWith("en") ? "en" : "zh-CN";
}

function t(key, variables = {}) {
  const dictionary = I18N[state.locale] || I18N["zh-CN"];
  const template = dictionary[key] || I18N["zh-CN"][key] || key;
  return template.replace(/\{(\w+)\}/gu, (_, name) => {
    const value = variables[name];
    return value == null ? "" : String(value);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
