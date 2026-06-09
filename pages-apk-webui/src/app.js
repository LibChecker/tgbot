import { escapeAttr, escapeHtml } from "./app/html.js";
import { getSupportedLocales, normalizeLocale, translate } from "./app/i18n.js";
import { clamp } from "./app/math.js";
import { formatBytes, formatResourceId, getInitial, sanitizeFilePart, sanitizeImageSrc, stripDataUris } from "./app/format.js";
import { COMPONENT_SECTIONS, countComponents, getStats, groupBy } from "./app/report-model.js";
import { buildHistorySummary, createHistoryEntry, persistHistory, persistHistoryCollapsed, readHistory, readHistoryCollapsed } from "./app/history.js";
import { CompareController } from "./app/compare-controller.js";
import { hydrateReportSdkIcons } from "./app/sdk-icon-cache.js";
import { getRegisteredSdkRuleDetail, renderSdkChip as renderSdkChipBase, renderSdkIcon, renderSdkInline as renderSdkInlineBase, renderSdkRuleLabel } from "./app/sdk-icon-renderer.js";
import { detectTerminalSystem } from "./app/system.js";
import { initAppTitleColorMask, initBrandTitleColorMask, renderBrandTitle } from "./app/title-effects.js";
const VALID_TABS = new Set(["summary", "sdk", "native", "components", "permissions", "signatures", "metadata", "raw"]);
const VALID_APP_MODES = new Set(["analyze", "compare"]);
const THEME_STORAGE_KEY = "apk-webui-theme";
const THEME_CHOICES = new Set(["light", "dark", "system"]);
const CONTRIBUTOR_GITHUB_ALIASES = new Map([
  ["absinthe", "zhaobozhen"],
]);
const systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");


const state = {
  appMode: "analyze",
  locale: normalizeLocale(navigator.language),
  themeChoice: readThemeChoice(),
  selectedFile: null,
  report: null,
  history: readHistory(),
  historyCollapsed: readHistoryCollapsed(),
  activeTab: "summary",
  activeNativeAbi: "",
  worker: null,
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
};
const modeDrag = {
  active: false,
  pointerId: null,
  pendingMode: "",
  suppressClick: false,
};

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

const compareController = new CompareController({
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
  },
  hasJob: (jobId) => state.jobs.has(jobId),
  updateClearButton,
});

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
    state.locale = normalizeLocale(elements.languageSelect.value);
    renderLanguageOptions();
    applyLocale();
    updateModeIndicator();
    updateThemeIndicator();
    updateHistoryCollapse();
    renderSelectedFile();
    renderHistoryList();
    renderReport();
    compareController.renderPage();
  });

  elements.fileInput.addEventListener("change", () => {
    setSelectedFile(elements.fileInput.files?.[0] || null);
  });

  elements.dropZone.addEventListener("pointerenter", (event) => {
    updateDropZonePointer(event);
    elements.dropZone.classList.add("is-pointer-active");
  });

  elements.dropZone.addEventListener("pointermove", (event) => {
    updateDropZonePointer(event);
    elements.dropZone.classList.add("is-pointer-active");
  });

  elements.dropZone.addEventListener("pointerleave", () => {
    elements.dropZone.classList.remove("is-pointer-active");
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

  elements.clearButton.addEventListener("click", () => {
    if (state.appMode === "compare") {
      compareController.reset();
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

    const id = button.dataset.historyId;
    if (button.dataset.historyAction === "open") {
      openHistoryItem(id);
    } else if (button.dataset.historyAction === "delete") {
      deleteHistoryItem(id);
    }
  });

  elements.historyList.addEventListener("pointerover", handleHistoryPointerEvent);
  elements.historyList.addEventListener("pointermove", handleHistoryPointerEvent);
  elements.historyList.addEventListener("pointerout", (event) => {
    const row = event.target.closest(".history-row");
    if (!row || row.contains(event.relatedTarget)) {
      return;
    }

    row.classList.remove("is-pointer-active");
  });

  elements.historyList.addEventListener("pointerleave", clearHistoryPointerState);

  document.addEventListener("pointermove", (event) => {
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

    state.activeTab = tab;
    updateTabs();
    renderTabPanel();
  });

  elements.tabPanel.addEventListener("click", (event) => {
    const exportButton = event.target.closest("[data-json-export]");
    if (exportButton) {
      if (state.report) {
        downloadReport(state.report);
      }
      return;
    }

    const button = event.target.closest("[data-native-abi]");
    if (!button || state.activeTab !== "native") {
      return;
    }

    state.activeNativeAbi = button.dataset.nativeAbi || "";
    renderTabPanel();
  });

  compareController.bindEvents();
}

function beginModeDrag(event) {
  if (event.button !== 0) {
    return;
  }

  modeDrag.active = true;
  modeDrag.pointerId = event.pointerId;
  modeDrag.suppressClick = true;
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
  let nearestMode = "";
  let nearestDistance = Infinity;

  for (const button of elements.modeButtons) {
    const rect = button.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const distance = Math.abs(clientX - centerX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestMode = button.dataset.appMode;
    }
  }

  return nearestMode;
}

function beginThemeDrag(event) {
  if (event.button !== 0) {
    return;
  }

  themeDrag.active = true;
  themeDrag.pointerId = event.pointerId;
  themeDrag.suppressClick = true;
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
  let nearestChoice = "";
  let nearestDistance = Infinity;

  for (const button of elements.themeButtons) {
    const rect = button.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const distance = Math.abs(clientX - centerX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestChoice = button.dataset.themeChoice;
    }
  }

  return nearestChoice;
}

function updateDropZonePointer(event, zone = elements.dropZone) {
  const rect = zone.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  zone.style.setProperty("--drop-x", `${x.toFixed(1)}px`);
  zone.style.setProperty("--drop-y", `${y.toFixed(1)}px`);
}

function handleHistoryPointerEvent(event) {
  const row = event.target.closest(".history-row");
  if (!row || !elements.historyList.contains(row)) {
    clearActiveHistoryRows();
    return;
  }

  const rect = row.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  row.style.setProperty("--history-row-glass-x", `${x.toFixed(1)}px`);
  row.style.setProperty("--history-row-glass-y", `${y.toFixed(1)}px`);

  clearActiveHistoryRows(row);
  row.classList.add("is-pointer-active");
}

function clearActiveHistoryRows(exceptRow = null) {
  elements.historyList.querySelectorAll(".history-row.is-pointer-active").forEach((row) => {
    if (row !== exceptRow) {
      row.classList.remove("is-pointer-active");
    }
  });
}

function clearHistoryPointerState() {
  clearActiveHistoryRows();
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

  document.addEventListener("pointerdown", (event) => {
    lastPointerType = event.pointerType || "";
  });
  document.addEventListener("pointerover", handleHoverEvent);
  document.addEventListener("pointermove", handleHoverEvent);
  document.addEventListener("mouseover", handleHoverEvent);
  document.addEventListener("mousemove", handleHoverEvent);
  document.addEventListener("pointerout", handleLeaveEvent);
  document.addEventListener("mouseout", handleLeaveEvent);
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
    const detail = getRegisteredSdkRuleDetail(label.dataset.ruleDetailId);
    const content = buildRulePreviewContent(label, detail);
    if (!content) {
      hidePreview();
      return;
    }

    const popup = ensurePreview();
    const pinned = Boolean(options.pinned);
    if (activeLabel === label) {
      activePinned = activePinned || pinned;
      popup.classList.toggle("is-pinned", activePinned);
      positionPreview(label);
      return;
    }

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

  document.addEventListener("pointerdown", (event) => {
    lastPointerType = event.pointerType || "";
  });
  document.addEventListener("pointerover", handleHoverEvent);
  document.addEventListener("pointermove", handleHoverEvent);
  document.addEventListener("mouseover", handleHoverEvent);
  document.addEventListener("mousemove", handleHoverEvent);
  document.addEventListener("pointerout", handleLeaveEvent);
  document.addEventListener("mouseout", handleLeaveEvent);
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

function shouldUseTapPopups(pointerType = "") {
  return (
    pointerType === "touch" ||
    pointerType === "pen" ||
    window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches
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
  compareController.setVisible(isCompare);

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
    elements.clearButton.disabled = !compareController.hasContent();
    return;
  }

  elements.clearButton.disabled = !state.selectedFile && !state.report;
}

function updateModeIndicator(appMode = state.appMode) {
  const activeButton = elements.modeButtons.find((button) => button.dataset.appMode === appMode);
  if (!activeButton || !elements.modeChipGroup) {
    return;
  }

  window.requestAnimationFrame(() => {
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
}

function updateThemeIndicator(themeChoice = state.themeChoice) {
  const activeButton = elements.themeButtons.find((button) => button.dataset.themeChoice === themeChoice);
  if (!activeButton || !elements.themeChipGroup) {
    return;
  }

  window.requestAnimationFrame(() => {
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

  const terminalSystem = await detectTerminalSystem();

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
  state.worker = null;

  for (const [, job] of jobs) {
    if (job.type === "compare") {
      compareController.finishJob(job.slotKey, null, message);
    } else {
      finishAnalysis();
      state.activeAnalyzeJobId = null;
      showError(message);
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
      compareController.handleProgress(
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
    if (job.type === "compare") {
      compareController.finishJob(job.slotKey, null, message.error || t("workerFailed"));
    } else {
      finishAnalysis();
      state.activeAnalyzeJobId = null;
      showError(message.error || t("workerFailed"));
    }
    return;
  }

  if (message.type === "result") {
    state.jobs.delete(message.jobId);
    if (job.type === "compare") {
      compareController.finishJob(job.slotKey, message.report, "");
      saveHistoryReport(message.report);
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
  if (state.activeAnalyzeJobId != null) {
    state.jobs.delete(state.activeAnalyzeJobId);
    state.activeAnalyzeJobId = null;
  }
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
  ];

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
  state.activeNativeAbi = "";
  elements.progress.hidden = true;
  elements.progress.classList.remove("is-complete");
  elements.progressTime.textContent = "0.0s";
  elements.progressLabel.textContent = t("progressReady");
  updateClearButton();
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

  persistHistoryCollapsed(state.historyCollapsed);
}

function updateHistoryCollapse() {
  setHistoryCollapsed(state.historyCollapsed, { persist: false });
}

function renderHistoryList() {
  elements.clearHistoryButton.disabled = state.history.length === 0;

  if (state.history.length === 0) {
    elements.historyList.innerHTML = emptyList(t("historyEmpty"));
    compareController.renderHistoryOptions();
    return;
  }

  elements.historyList.innerHTML = state.history.map(renderHistoryItem).join("");
  compareController.renderHistoryOptions();
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
  if (state.appMode !== "analyze") {
    elements.emptyState.hidden = true;
    elements.resultView.hidden = true;
    return;
  }

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
  initAppTitleColorMask(elements.reportHero, state.report.apkInfo);
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
  const details = [
    component.sdk ? { label: t("detectedRule"), html: renderSdkInline(component.sdk) } : null,
    component.permission ? { label: t("permission"), value: component.permission } : null,
    component.process ? { label: t("process"), value: component.process } : null,
    component.authorities ? { label: t("authorities"), value: component.authorities } : null,
    component.targetActivity ? { label: t("targetActivity"), value: component.targetActivity } : null,
    component.actions?.length ? { label: t("actions"), value: component.actions.join(", ") } : null,
  ].filter((item) => item?.html || item?.value);

  return [
    `<article class="list-row component-row">`,
    `<div class="component-row-header">`,
    `<div class="component-row-main">`,
    `<div class="row-title component-row-title"><span>${escapeHtml(component.name || t("unknown"))}</span></div>`,
    `</div>`,
    `</div>`,
    details.length ? renderComponentDetails(details) : "",
    `</article>`,
  ].join("");
}

function renderComponentDetails(details) {
  const rows = details.map((item) => [
    item.label,
    item.html || inlineCodeValue(item.value),
  ]);

  return renderHtmlKeyValueTable(rows, "component-detail-table divider-kv-table");
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

  return `${escapeHtml(t("value"))}${state.locale === "zh-CN" ? "：" : ": "}${value}`;
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
      `<div class="sdk-title">${renderSdkIcon(entry.iconUrl, entry.label, entry.singleColorIcon)}${renderSdkRuleLabel(entry, t("unknown"))}</div>`,
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
