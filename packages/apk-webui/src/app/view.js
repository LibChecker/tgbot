/** @typedef {HTMLElement & HTMLInputElement} AppElement */

/**
 * @param {Document | Element} root
 * @param {string} selector
 * @returns {AppElement}
 */
function queryAppElement(root, selector) {
  return /** @type {AppElement} */ (root.querySelector(selector));
}

/**
 * @param {Document | Element} root
 * @param {string} selector
 * @returns {AppElement[]}
 */
function queryAppElements(root, selector) {
  return /** @type {AppElement[]} */ ([...root.querySelectorAll(selector)]);
}

export function collectAppElements(root = document) {
  return {
    modeButtons: queryAppElements(root, "[data-app-mode]"),
    modeChipGroup: queryAppElement(root, "#mode-chip-group"),
    topbar: queryAppElement(root, ".topbar"),
    brand: queryAppElement(root, ".brand"),
    brandAppIconFace: queryAppElement(root, "[data-brand-app-icon-face]"),
    topbarActions: queryAppElement(root, ".topbar-actions"),
    mobileBottomControls: queryAppElement(root, "#mobile-bottom-controls"),
    themeButtons: queryAppElements(root, ".theme-chip[data-theme-choice]"),
    themeChipGroup: queryAppElement(root, "#theme-chip-group"),
    languageSelect: queryAppElement(root, "#language-select"),
    topbarGithubLink: queryAppElement(root, ".topbar-github-link"),
    clearButton: queryAppElement(root, "#clear-button"),
    backgroundCanvas: queryAppElement(root, "#color-orb-background"),
    brandTitle: queryAppElement(root, ".brand-title"),
    form: queryAppElement(root, "#analyze-form"),
    fileInput: queryAppElement(root, "#file-input"),
    fileMeta: queryAppElement(root, "#file-meta"),
    dropZone: queryAppElement(root, "#drop-zone"),
    linkZone: queryAppElement(root, "#link-zone"),
    linkInput: queryAppElement(root, "#link-input"),
    linkClearButton: queryAppElement(root, "#link-clear-button"),
    linkStatus: queryAppElement(root, "#link-status"),
    linkSubmitButton: queryAppElement(root, "#link-submit-button"),
    analyzeButton: queryAppElement(root, "#analyze-button"),
    analyzeButtonLabel: queryAppElement(root, "#analyze-button span"),
    progress: queryAppElement(root, "#progress"),
    progressLabel: queryAppElement(root, "#progress-label"),
    progressTime: queryAppElement(root, "#progress-time"),
    progressPercent: queryAppElement(root, "#progress-percent"),
    errorBox: queryAppElement(root, "#error-box"),
    runtimeLogOpen: queryAppElement(root, "#runtime-log-open"),
    runtimeLogModal: queryAppElement(root, "#runtime-log-modal"),
    runtimeLogPanel: queryAppElement(root, "#runtime-log-panel"),
    runtimeLogExport: queryAppElement(root, "#runtime-log-export"),
    runtimeLogClose: queryAppElement(root, "#runtime-log-close"),
    runtimeLogList: queryAppElement(root, "#runtime-log-list"),
    appVersion: queryAppElement(root, "#app-version"),
    historyPanel: queryAppElement(root, "#history-panel"),
    historyToggleButton: queryAppElement(root, "#history-toggle-button"),
    historyViewGroup: queryAppElement(root, "#history-view-switch"),
    historyViewButtons: queryAppElements(root, "[data-history-view-mode]"),
    historyContent: queryAppElement(root, "#history-content"),
    historyList: queryAppElement(root, "#history-list"),
    clearHistoryButton: queryAppElement(root, "#clear-history-button"),
    emptyState: queryAppElement(root, "#empty-state"),
    resultView: queryAppElement(root, "#result-view"),
    reportHero: queryAppElement(root, "#report-hero"),
    reportShareButton: queryAppElement(root, "#report-share-button"),
    archiveDistribution: queryAppElement(root, "#archive-distribution"),
    tabs: queryAppElement(root, "#tabs"),
    tabButtons: queryAppElements(root, "#tabs [data-tab]"),
    tabPanel: queryAppElement(root, "#tab-panel"),
    compareView: queryAppElement(root, "#compare-view"),
    compareSlots: queryAppElement(root, "#compare-slots"),
    compareWarning: queryAppElement(root, "#compare-warning"),
    compareResult: queryAppElement(root, "#compare-result"),
    compareFileInputs: queryAppElements(root, "[data-compare-file]"),
    compareDropZones: queryAppElements(root, "[data-compare-drop]"),
    compareHistorySelects: queryAppElements(root, "[data-compare-history]"),
    compareClearButtons: queryAppElements(root, "[data-compare-clear]"),
    lcappsPicker: queryAppElement(root, "#lcapps-picker"),
    lcappsPickerPanel: queryAppElement(root, "#lcapps-picker-panel"),
    lcappsPickerTitle: queryAppElement(root, "#lcapps-picker-title"),
    lcappsPickerSubtitle: queryAppElement(root, "#lcapps-picker-subtitle"),
    lcappsPickerClose: queryAppElement(root, "#lcapps-picker-close"),
    lcappsSearch: queryAppElement(root, "#lcapps-search"),
    lcappsStatus: queryAppElement(root, "#lcapps-status"),
    lcappsGrid: queryAppElement(root, "#lcapps-grid"),
    lcappsBubble: queryAppElement(root, "#lcapps-bubble"),
    lcappsBubbleContent: queryAppElement(root, "#lcapps-bubble-content"),
    i18nNodes: queryAppElements(root, "[data-i18n]"),
    titleI18nNodes: queryAppElements(root, "[data-title-i18n]"),
    ariaI18nNodes: queryAppElements(root, "[data-aria-i18n]"),
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
