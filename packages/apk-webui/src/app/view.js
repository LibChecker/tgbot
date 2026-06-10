export function collectAppElements(root = document) {
  return {
    modeButtons: [...root.querySelectorAll("[data-app-mode]")],
    modeChipGroup: root.querySelector("#mode-chip-group"),
    themeButtons: [...root.querySelectorAll(".theme-chip[data-theme-choice]")],
    themeChipGroup: root.querySelector("#theme-chip-group"),
    languageSelect: root.querySelector("#language-select"),
    clearButton: root.querySelector("#clear-button"),
    backgroundCanvas: root.querySelector("#color-orb-background"),
    brandTitle: root.querySelector(".brand-title"),
    form: root.querySelector("#analyze-form"),
    fileInput: root.querySelector("#file-input"),
    fileMeta: root.querySelector("#file-meta"),
    dropZone: root.querySelector("#drop-zone"),
    analyzeButton: root.querySelector("#analyze-button"),
    analyzeButtonLabel: root.querySelector("#analyze-button span"),
    progress: root.querySelector("#progress"),
    progressLabel: root.querySelector("#progress-label"),
    progressTime: root.querySelector("#progress-time"),
    errorBox: root.querySelector("#error-box"),
    historyPanel: root.querySelector("#history-panel"),
    historyToggleButton: root.querySelector("#history-toggle-button"),
    historyContent: root.querySelector("#history-content"),
    historyList: root.querySelector("#history-list"),
    clearHistoryButton: root.querySelector("#clear-history-button"),
    emptyState: root.querySelector("#empty-state"),
    resultView: root.querySelector("#result-view"),
    reportHero: root.querySelector("#report-hero"),
    archiveDistribution: root.querySelector("#archive-distribution"),
    tabs: root.querySelector("#tabs"),
    tabButtons: [...root.querySelectorAll("#tabs [data-tab]")],
    tabPanel: root.querySelector("#tab-panel"),
    compareView: root.querySelector("#compare-view"),
    compareSlots: root.querySelector("#compare-slots"),
    compareWarning: root.querySelector("#compare-warning"),
    compareResult: root.querySelector("#compare-result"),
    compareFileInputs: [...root.querySelectorAll("[data-compare-file]")],
    compareDropZones: [...root.querySelectorAll("[data-compare-drop]")],
    compareHistorySelects: [...root.querySelectorAll("[data-compare-history]")],
    compareClearButtons: [...root.querySelectorAll("[data-compare-clear]")],
    i18nNodes: [...root.querySelectorAll("[data-i18n]")],
    titleI18nNodes: [...root.querySelectorAll("[data-title-i18n]")],
    ariaI18nNodes: [...root.querySelectorAll("[data-aria-i18n]")],
  };
}

export function hideAnalyzeReportViews(elements) {
  elements.emptyState.hidden = true;
  elements.resultView.hidden = true;
}

export function showEmptyReportState(elements) {
  elements.emptyState.hidden = false;
  elements.resultView.hidden = true;
  elements.reportHero.innerHTML = "";
  elements.archiveDistribution.innerHTML = "";
  elements.archiveDistribution.hidden = true;
  elements.resultView.classList.remove("has-archive-distribution");
  elements.tabPanel.innerHTML = "";
}

export function showReportState(elements, { heroHtml, archiveDistributionHtml }) {
  elements.emptyState.hidden = true;
  elements.resultView.hidden = false;
  elements.reportHero.innerHTML = heroHtml;
  elements.archiveDistribution.innerHTML = archiveDistributionHtml;
  elements.archiveDistribution.hidden = !archiveDistributionHtml;
  elements.resultView.classList.toggle("has-archive-distribution", Boolean(archiveDistributionHtml));
}

export function updateTabButtons(elements, activeTab) {
  elements.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });
}

export function setTabPanelHtml(elements, html) {
  elements.tabPanel.innerHTML = html;
}
