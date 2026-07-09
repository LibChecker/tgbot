import "../report-share-modal.css";
import { getInitial, sanitizeImageSrc } from "./format.js";
import { escapeAttr, escapeHtml } from "./html.js";
import { prepareReportShareUrl, shareReportUrl } from "./report-share.js";

const BOT_REPORT_DATA_ORIGIN = typeof __BOT_REPORT_DATA_ORIGIN__ === "string" ? __BOT_REPORT_DATA_ORIGIN__ : "";

export async function prepareAndOpenReportShare({
  state,
  elements,
  t,
  pageHref,
  pageSearch,
  onClose,
  onControlsChange,
}) {
  try {
    state.reportShareUrl = await prepareReportShareUrl({
      cachedUrl: state.reportShareUrl,
      report: state.report,
      locale: state.locale,
      reportDataOrigin: BOT_REPORT_DATA_ORIGIN || window.location.origin,
      pageHref,
      pageSearch,
    });
    state.reportShareStatusKey = "reportShareReady";
  } catch {
    state.reportShareStatusKey = "reportShareFailed";
  } finally {
    const shouldOpen = state.reportShareBusy;
    state.reportShareBusy = false;
    onControlsChange();
    if (shouldOpen) {
      openReportShareModal({ state, elements, t, onClose, onControlsChange });
    }
  }
}

export function openReportShareModal({ state, elements, t, onClose, onControlsChange }) {
  state.reportShareModalOpen = true;
  Object.assign(elements, ensureReportShareModalElements({
    t,
    onClose,
    onActionClick: (event) => handleReportShareModalActionClick(event, {
      state,
      elements,
      t,
      onControlsChange,
    }),
  }));
  elements.reportShareModal.hidden = false;
  renderReportShareModal({ state, elements, t });
  window.setTimeout(() => {
    elements.reportSharePanel?.focus();
  }, 0);
}

export function renderReportShareModal({ state, elements, t }) {
  if (!elements.reportShareBody) {
    return;
  }

  const shareUrl = state.reportShareUrl || "";
  const statusKey = state.reportShareStatusKey || (shareUrl ? "reportShareReady" : "reportShareFailed");
  updateReportShareModalChrome(elements, t);
  renderReportShareModalContent({
    body: elements.reportShareBody,
    report: state.report,
    shareUrl,
    statusKey,
    actionBusy: state.reportShareActionBusy,
    t,
  });
}

function handleReportShareModalActionClick(event, context) {
  const action = event.target.closest?.("[data-report-share-action]")?.dataset.reportShareAction;
  if (action === "copy" || action === "share") {
    void runReportShareAction(action, context);
  }
}

async function runReportShareAction(action, { state, elements, t, onControlsChange }) {
  if (!state.reportShareUrl || state.reportShareActionBusy) {
    return;
  }

  state.reportShareActionBusy = true;
  renderReportShareModal({ state, elements, t });
  try {
    if (action === "copy") {
      await navigator.clipboard.writeText(state.reportShareUrl);
      state.reportShareStatusKey = "reportShareCopied";
    } else {
      const result = await shareReportUrl({
        url: state.reportShareUrl,
        title: t("reportShareTitle"),
        text: t("reportShareText", {
          appName: state.report?.apkInfo?.appName || state.report?.apkInfo?.packageName || t("unknown"),
        }),
      });
      if (!result?.cancelled) {
        state.reportShareStatusKey = result?.operation === "copy" ? "reportShareCopied" : "reportShareShared";
      }
    }
  } catch {
    state.reportShareStatusKey = "reportShareFailed";
  } finally {
    state.reportShareActionBusy = false;
    onControlsChange();
    renderReportShareModal({ state, elements, t });
  }
}

export function ensureReportShareModalElements({ root = document.body, t, onClose, onActionClick }) {
  let modal = root.querySelector("#report-share-modal");
  if (!modal) {
    root.insertAdjacentHTML("beforeend", renderReportShareModalShell());
    modal = root.querySelector("#report-share-modal");
  }

  const refs = {
    reportShareModal: modal,
    reportSharePanel: modal.querySelector("#report-share-panel"),
    reportShareClose: modal.querySelector("#report-share-close"),
    reportShareTitle: modal.querySelector("#report-share-dialog-title"),
    reportShareSubtitle: modal.querySelector("#report-share-dialog-subtitle"),
    reportShareBody: modal.querySelector("#report-share-body"),
  };

  if (modal.dataset.reportShareBound !== "true") {
    refs.reportShareClose?.addEventListener("click", onClose);
    refs.reportShareModal?.addEventListener("click", (event) => {
      if (event.target === refs.reportShareModal) {
        onClose();
      }
    });
    refs.reportShareBody?.addEventListener("click", onActionClick);
    modal.dataset.reportShareBound = "true";
  }

  updateReportShareModalChrome(refs, t);
  return refs;
}

export function updateReportShareModalChrome(elements, t) {
  if (elements.reportShareTitle) {
    elements.reportShareTitle.textContent = t("reportShareDialogTitle");
  }
  if (elements.reportShareSubtitle) {
    elements.reportShareSubtitle.textContent = t("reportShareDialogSubtitle");
  }
  if (elements.reportShareClose) {
    const label = t("reportShareClose");
    elements.reportShareClose.setAttribute("aria-label", label);
    elements.reportShareClose.title = label;
  }
}

export function renderReportShareModalContent({ body, report, shareUrl, statusKey, actionBusy, t }) {
  if (!body) {
    return;
  }

  const info = report?.apkInfo || {};
  const title = info.appName || info.packageName || t("unknown");
  const packageName = info.packageName || t("unknown");
  const canNativeShare = Boolean(navigator.share);
  const isFailure = statusKey === "reportShareFailed";
  const nativeDisabled = !shareUrl || actionBusy || !canNativeShare;
  const copyDisabled = !shareUrl || actionBusy || !navigator.clipboard?.writeText;

  body.innerHTML = [
    `<div class="report-share-app">`,
    renderReportShareAppIcon(info, t),
    `<div class="report-share-app-copy">`,
    `<strong>${escapeHtml(title)}</strong>`,
    `<code class="app-data-text">${escapeHtml(packageName)}</code>`,
    `</div>`,
    `</div>`,
    `<label class="report-share-link-field">`,
    `<span>${escapeHtml(t("reportShareLinkLabel"))}</span>`,
    `<input class="app-data-text" value="${escapeAttr(shareUrl || t("reportShareNoLink"))}" readonly>`,
    `</label>`,
    `<div class="report-share-actions">`,
    `<button class="primary-button report-share-copy" type="button" data-report-share-action="copy" ${copyDisabled ? "disabled" : ""}>${escapeHtml(t("reportShareCopy"))}</button>`,
    `<button class="secondary-button report-share-system" type="button" data-report-share-action="share" ${nativeDisabled ? "disabled" : ""}>${escapeHtml(t("reportShareSystem"))}</button>`,
    `</div>`,
    `<p class="report-share-status${isFailure ? " is-error" : ""}" aria-live="polite">${escapeHtml(t(statusKey))}</p>`,
  ].join("");
}

function renderReportShareModalShell() {
  return [
    `<div class="report-share-modal" id="report-share-modal" hidden>`,
    `<section class="report-share-panel" id="report-share-panel" role="dialog" aria-modal="true" aria-labelledby="report-share-dialog-title" tabindex="-1">`,
    `<header class="report-share-header">`,
    `<div>`,
    `<h2 id="report-share-dialog-title"></h2>`,
    `<p id="report-share-dialog-subtitle"></p>`,
    `</div>`,
    `<button class="icon-button report-share-close" id="report-share-close" type="button">`,
    `<svg viewBox="4 4 16 16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`,
    `<path d="M6 18 18 6M6 6l12 12"></path>`,
    `</svg>`,
    `</button>`,
    `</header>`,
    `<div class="report-share-body" id="report-share-body"></div>`,
    `</section>`,
    `</div>`,
  ].join("");
}

function renderReportShareAppIcon(info, t) {
  const src = sanitizeImageSrc(info?.icon || "");
  if (src) {
    return `<img class="report-share-app-icon" src="${escapeAttr(src)}" alt="${escapeAttr(info.appName || t("appName"))}">`;
  }

  return `<span class="report-share-app-icon report-share-app-icon--placeholder" aria-hidden="true">${escapeHtml(getInitial(info?.appName || info?.packageName || ""))}</span>`;
}
