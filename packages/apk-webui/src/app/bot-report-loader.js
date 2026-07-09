import { assertReportDataReport } from "@shared/contracts.js";

export async function loadBotReportFromUrl([
  reportUrl,
  state,
  elements,
  t,
  cancelLcappsReportActivation,
  finishAnalysis,
  getClientErrorTelemetryFields,
  getElapsedMs,
  getErrorMessage,
  getReportAnalyticsFields,
  hideError,
  preloadReportRenderer,
  renderLinkStatus,
  renderReport,
  renderSelectedFile,
  revealReportHeroAfterAnalysis,
  scheduleHistoryReportSave,
  scheduleReportSdkRuleDetailHydration,
  hydrateReportSdkIconImagesForRender,
  setAppMode,
  setBusy,
  showError,
  showProgress,
  startTimer,
  trackWebEvent,
  updateClearButton,
]) {
  hideError();
  cancelLcappsReportActivation();
  state.linkAbortController?.abort();
  state.linkAbortController = null;
  if (state.activeAnalyzeJobId != null) {
    state.jobs.delete(state.activeAnalyzeJobId);
    state.activeAnalyzeJobId = null;
  }
  state.jobId += 1;
  const jobId = state.jobId;
  const abortController = new AbortController();
  state.jobs.set(jobId, {
    type: "bot-report",
  });
  state.activeAnalyzeJobId = jobId;
  state.startedAt = performance.now();
  state.report = null;
  state.reportShareUrl = "";
  state.reportShareStatusKey = "";
  state.reportShareBusy = false;
  state.selectedFile = null;
  state.downloadUrl = "";
  state.activeTab = "summary";
  state.activeNativeAbi = "";
  state.linkStatusKey = "linkIdle";
  state.linkAbortController = abortController;

  if (elements.fileInput) {
    elements.fileInput.value = "";
  }
  if (elements.linkInput) {
    elements.linkInput.value = "";
  }

  setAppMode("analyze");
  renderSelectedFile();
  renderLinkStatus();
  updateClearButton();
  preloadReportRenderer();
  setBusy(true);
  showProgress("progressPreparingLink", { progress: 0.12 });
  startTimer();
  trackWebEvent("webui.bot_report.started", {
    result: "started",
    input_source: "bot",
  });

  try {
    const response = await fetch(reportUrl, {
      headers: {
        accept: "application/json",
      },
      signal: abortController.signal,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error?.message || t("unknownError"));
    }

    const report = assertReportDataReport(payload?.report);
    if (!state.jobs.has(jobId)) {
      return;
    }

    await hydrateReportSdkIconImagesForRender(report);
    if (!state.jobs.has(jobId)) {
      return;
    }

    state.jobs.delete(jobId);
    state.activeAnalyzeJobId = null;
    state.linkAbortController = null;
    state.report = report;
    state.reportShareUrl = "";
    state.reportShareStatusKey = "";
    state.reportShareBusy = false;
    state.activeTab = "summary";
    state.activeNativeAbi = "";
    finishAnalysis();
    showProgress("progressDone");
    void renderReport()
      .then(() => revealReportHeroAfterAnalysis(report))
      .catch(() => {});
    scheduleHistoryReportSave(report);
    scheduleReportSdkRuleDetailHydration(report);
    trackWebEvent("webui.bot_report.succeeded", {
      result: "success",
      input_source: "bot",
      client_duration_ms: getElapsedMs(state.startedAt),
      ...getReportAnalyticsFields(report),
    });
  } catch (error) {
    if (error?.name === "AbortError" || !state.jobs.has(jobId)) {
      return;
    }

    state.jobs.delete(jobId);
    state.activeAnalyzeJobId = null;
    state.linkAbortController = null;
    finishAnalysis();
    showProgress("progressFailed");
    showError(getErrorMessage(error) || t("unknownError"));
    trackWebEvent("webui.bot_report.failed", {
      result: "error",
      input_source: "bot",
      client_duration_ms: getElapsedMs(state.startedAt),
      ...getClientErrorTelemetryFields(error),
    });
  }
}
