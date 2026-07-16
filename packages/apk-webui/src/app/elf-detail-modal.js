import "../elf-detail-modal.css";

import { formatBytes } from "./format.js";
import { escapeAttr, escapeHtml } from "./html.js";

const SYMBOL_RENDER_LIMIT = 500;
const SECTION_RENDER_LIMIT = 512;
const DYNAMIC_RENDER_LIMIT = 512;
const ELF_DETAIL_LOADING_DELAY_MS = 150;
const ELF_DETAIL_CLOSE_FALLBACK_MS = 150;

let requestToken = 0;
let loadingTimer = 0;
let closeTimer = 0;
/** @type {HTMLElement | null} */
let restoreFocusTarget = null;

/**
 * @typedef {{
 *   library: Record<string, any>,
 *   loadDetails: () => Promise<any>,
 *   sourceAvailable: boolean,
 *   t: (key: string, variables?: Record<string, unknown>) => string,
 *   trigger?: HTMLElement | null,
 *   onLoaded?: (result: string) => void
 * }} ElfDetailModalOptions
 */

/** @param {ElfDetailModalOptions} options */
export function openElfDetailModal({
  library,
  loadDetails,
  sourceAvailable,
  t,
  trigger,
  onLoaded = () => {},
}) {
  const elements = ensureElfDetailModalElements(t);
  const token = ++requestToken;
  restoreFocusTarget = trigger || null;
  updateElfDetailModalHeader(elements, library, t);
  elements.dialog.classList.toggle("has-source", sourceAvailable);
  clearLoadingTimer();

  if (!sourceAvailable) {
    elements.body.innerHTML = renderElfDetailUnavailable(library, t);
    elements.body.setAttribute("aria-busy", "false");
    showElfDetailDialog(elements.dialog);
    onLoaded("unavailable");
    return;
  }

  elements.body.setAttribute("aria-busy", "true");
  loadingTimer = window.setTimeout(() => {
    loadingTimer = 0;
    if (token !== requestToken) {
      return;
    }
    elements.body.innerHTML = renderElfDetailLoading(library, t);
    showElfDetailDialog(elements.dialog);
  }, ELF_DETAIL_LOADING_DELAY_MS);

  void Promise.resolve()
    .then(loadDetails)
    .then((details) => {
      if (token !== requestToken) {
        return;
      }
      clearLoadingTimer();
      elements.body.setAttribute("aria-busy", "false");
      elements.body.innerHTML = renderElfDetailContent({ details, library, t });
      showElfDetailDialog(elements.dialog);
      onLoaded("success");
    })
    .catch(() => {
      if (token !== requestToken) {
        return;
      }
      clearLoadingTimer();
      elements.body.setAttribute("aria-busy", "false");
      elements.body.innerHTML = renderElfDetailError(library, t);
      showElfDetailDialog(elements.dialog);
      onLoaded("error");
    });
}

export function closeElfDetailModal() {
  requestToken += 1;
  clearLoadingTimer();
  const dialog = /** @type {HTMLDialogElement | null} */ (document.querySelector("#elf-detail-dialog"));
  if (!dialog?.open || dialog.classList.contains("is-closing")) {
    return;
  }

  dialog.classList.remove("is-open");
  dialog.classList.add("is-closing");
  const closeDurationMs = getElfDetailModalCloseDurationMs(dialog);
  closeTimer = window.setTimeout(() => {
    closeTimer = 0;
    if (dialog.open && dialog.classList.contains("is-closing")) {
      dialog.close();
    }
  }, closeDurationMs);
}

export function getElfDetailModalCloseDurationMs(dialog) {
  if (
    !dialog ||
    typeof window === "undefined" ||
    typeof window.getComputedStyle !== "function"
  ) {
    return ELF_DETAIL_CLOSE_FALLBACK_MS;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return 0;
  }
  return parseCssTimeMs(
    window.getComputedStyle(dialog).getPropertyValue("--modal-close-dur"),
    ELF_DETAIL_CLOSE_FALLBACK_MS,
  );
}

export function parseCssTimeMs(value, fallbackMs = 0) {
  const normalized = String(value || "").trim();
  if (normalized.endsWith("ms")) {
    const milliseconds = Number.parseFloat(normalized);
    return Number.isFinite(milliseconds) ? milliseconds : fallbackMs;
  }
  if (normalized.endsWith("s")) {
    const seconds = Number.parseFloat(normalized);
    return Number.isFinite(seconds) ? seconds * 1000 : fallbackMs;
  }
  return fallbackMs;
}

export function shouldCloseElfDetailModalOnBackdropClick(event, dialog, pointerStartedOnBackdrop) {
  return pointerStartedOnBackdrop && event.target === dialog;
}

export function renderElfDetailContent({ details, library, t }) {
  const header = details?.header || {};
  const dynamic = details?.dynamic || {};
  const counts = details?.counts || {};
  const truncated = details?.truncated || {};

  return [
    renderElfDetailFacts(library, details, t),
    `<div class="elf-detail-groups">`,
    renderDetailGroup(
      t("elfHeader"),
      "",
      renderKeyValueRows([
        ["Class", header.class],
        ["Data", header.byteOrder],
        ["OS/ABI", header.osAbi],
        ["ABI version", header.abiVersion],
        ["Type", header.type],
        ["Machine", header.machine],
        ["Version", header.version],
        ["Entry point", header.entryPoint],
        ["Flags", header.flags],
        ["ELF header size", header.headerSize],
        ["Program header offset", header.programHeaderOffset],
        ["Program header entry size", header.programHeaderEntrySize],
        ["Program header count", header.programHeaderCount],
        ["Section header offset", header.sectionHeaderOffset],
        ["Section header entry size", header.sectionHeaderEntrySize],
        ["Section header count", header.sectionHeaderCount],
        ["Section name index", header.sectionNameIndex],
      ], t),
      true,
    ),
    renderDetailGroup(
      t("elfProgramHeaders"),
      counts.programHeaders,
      renderDataTable(t("elfProgramHeaders"), [
        ["#", "index"],
        ["Type", "type"],
        ["Flags", "flags"],
        ["Offset", "offset"],
        ["VAddr", "virtualAddress"],
        ["PAddr", "physicalAddress"],
        ["File size", "fileSize"],
        ["Memory size", "memorySize"],
        ["Align", "alignment"],
      ], details?.programHeaders, counts.programHeaders, Number.POSITIVE_INFINITY, t, truncated.programHeaders),
    ),
    renderDetailGroup(
      t("elfSectionHeaders"),
      counts.sectionHeaders,
      renderDataTable(t("elfSectionHeaders"), [
        ["#", "index"],
        ["Name", "name"],
        ["Type", "type"],
        ["Flags", "flags"],
        ["Address", "address"],
        ["Offset", "offset"],
        ["Size", "size"],
        ["Link", "link"],
        ["Info", "info"],
        ["Align", "alignment"],
        ["Entry size", "entrySize"],
      ], details?.sectionHeaders, counts.sectionHeaders, SECTION_RENDER_LIMIT, t, truncated.sectionHeaders),
    ),
    renderDetailGroup(
      t("elfDynamicLinks"),
      counts.dynamicEntries,
      renderDynamicContent(dynamic, counts.dynamicEntries, t, truncated.dynamicEntries),
    ),
    renderDetailGroup(
      t("elfSymbols"),
      counts.symbols,
      renderDataTable(t("elfSymbols"), [
        ["Table", "table"],
        ["#", "index"],
        ["Name", "name"],
        ["Value", "value"],
        ["Size", "size"],
        ["Bind", "binding"],
        ["Type", "type"],
        ["Visibility", "visibility"],
        ["Section", "section"],
      ], details?.symbols, counts.symbols, SYMBOL_RENDER_LIMIT, t, truncated.symbols),
    ),
    renderDetailGroup(
      t("elfNotes"),
      counts.notes,
      renderDataTable(t("elfNotes"), [
        ["Section", "section"],
        ["Owner", "owner"],
        ["Type", "type"],
        ["Description", "description"],
        ["Bytes", "descriptionSize"],
      ], details?.notes, counts.notes, Number.POSITIVE_INFINITY, t, truncated.notes),
    ),
    `</div>`,
  ].join("");
}

function ensureElfDetailModalElements(t) {
  let dialog = /** @type {HTMLDialogElement | null} */ (document.querySelector("#elf-detail-dialog"));
  if (!dialog) {
    document.body.insertAdjacentHTML("beforeend", renderElfDetailModalShell(t));
    dialog = /** @type {HTMLDialogElement | null} */ (document.querySelector("#elf-detail-dialog"));
    if (!dialog) {
      throw new Error("Failed to create ELF detail dialog");
    }
    let pointerStartedOnBackdrop = false;
    dialog.querySelector("#elf-detail-close")?.addEventListener("click", closeElfDetailModal);
    dialog.addEventListener("pointerdown", (event) => {
      pointerStartedOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener("click", (event) => {
      if (shouldCloseElfDetailModalOnBackdropClick(event, dialog, pointerStartedOnBackdrop)) {
        closeElfDetailModal();
      }
      pointerStartedOnBackdrop = false;
    });
    dialog.addEventListener("pointercancel", () => {
      pointerStartedOnBackdrop = false;
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeElfDetailModal();
    });
    dialog.addEventListener("close", () => {
      requestToken += 1;
      clearLoadingTimer();
      clearCloseTimer();
      dialog.classList.remove("is-open", "is-closing");
      const target = restoreFocusTarget;
      restoreFocusTarget = null;
      target?.focus?.();
    });
  }

  return {
    dialog,
    title: dialog.querySelector("#elf-detail-title"),
    subtitle: dialog.querySelector("#elf-detail-subtitle"),
    body: dialog.querySelector("#elf-detail-body"),
    close: dialog.querySelector("#elf-detail-close"),
  };
}

function showElfDetailDialog(dialog) {
  clearCloseTimer();
  const wasOpen = dialog.open;
  dialog.classList.remove("is-closing");
  if (!wasOpen) {
    dialog.classList.remove("is-open");
    dialog.showModal();
    dialog.getBoundingClientRect();
  }
  dialog.classList.add("is-open");
}

function clearLoadingTimer() {
  if (!loadingTimer) {
    return;
  }
  window.clearTimeout(loadingTimer);
  loadingTimer = 0;
}

function clearCloseTimer() {
  if (!closeTimer) {
    return;
  }
  window.clearTimeout(closeTimer);
  closeTimer = 0;
}

function renderElfDetailModalShell(t) {
  const closeLabel = t("lcappsClose");
  return [
    `<dialog class="elf-detail-dialog" id="elf-detail-dialog" aria-labelledby="elf-detail-title" aria-describedby="elf-detail-subtitle">`,
    `<section class="elf-detail-panel">`,
    `<header class="elf-detail-header">`,
    `<div class="elf-detail-heading">`,
    `<span class="elf-detail-kicker">ELF</span>`,
    `<h2 id="elf-detail-title"></h2>`,
    `<p id="elf-detail-subtitle" class="app-data-text"></p>`,
    `</div>`,
    `<button class="icon-button elf-detail-close" id="elf-detail-close" type="button" aria-label="${escapeAttr(closeLabel)}" title="${escapeAttr(closeLabel)}">`,
    `<svg viewBox="4 4 16 16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" aria-hidden="true"><path d="M6 18 18 6M6 6l12 12"></path></svg>`,
    `</button>`,
    `</header>`,
    `<div class="elf-detail-body" id="elf-detail-body"></div>`,
    `</section>`,
    `</dialog>`,
  ].join("");
}

function updateElfDetailModalHeader(elements, library, t) {
  elements.title.textContent = library?.name || t("unknown");
  elements.subtitle.textContent = [library?.abi, library?.sourceEntry, library?.path]
    .filter(Boolean)
    .join(" · ");
  const closeLabel = t("lcappsClose");
  elements.close.setAttribute("aria-label", closeLabel);
  elements.close.title = closeLabel;
}

function renderElfDetailLoading(library, t) {
  return [
    renderElfDetailFacts(library, null, t),
    `<div class="elf-detail-status" role="status" aria-live="polite" aria-atomic="true">`,
    `<span class="elf-detail-spinner" aria-hidden="true"></span>`,
    `<p>${escapeHtml(t("elfDetailsLoading"))}</p>`,
    `</div>`,
  ].join("");
}

function renderElfDetailUnavailable(library, t) {
  return [
    renderElfDetailFacts(library, null, t),
    `<div class="elf-detail-status is-empty" role="status">`,
    `<strong>${escapeHtml(t("elfDetailsUnavailableTitle"))}</strong>`,
    `<p>${escapeHtml(t("elfDetailsSourceUnavailable"))}</p>`,
    `</div>`,
  ].join("");
}

function renderElfDetailError(library, t) {
  return [
    renderElfDetailFacts(library, null, t),
    `<div class="elf-detail-status is-error" role="alert">`,
    `<strong>${escapeHtml(t("elfDetailsUnavailableTitle"))}</strong>`,
    `<p>${escapeHtml(t("elfDetailsUnavailable"))}</p>`,
    `</div>`,
  ].join("");
}

function renderElfDetailFacts(library, details, t) {
  const pageSize = Number(library?.elfPageSize) || 0;
  const zipAlignment = Number(library?.zipAlignment) || 0;
  const facts = [
    ["ABI", library?.abi || t("unknown")],
    [t("size"), formatBytes(library?.size || details?.byteLength || 0)],
    [t("elfClass"), details?.header?.class || t("unknown")],
    [t("elfPageAlignment"), pageSize > 0 ? formatAlignmentBytes(pageSize) : t("unknown")],
    ["ZIPALIGN", zipAlignment > 0 ? formatAlignmentBytes(zipAlignment) : t("unknown")],
  ];

  return [
    `<dl class="elf-detail-facts">`,
    facts.map(([label, value]) => [
      `<div>`,
      `<dt>${escapeHtml(label)}</dt>`,
      `<dd class="app-data-text">${escapeHtml(String(value))}</dd>`,
      `</div>`,
    ].join("")).join(""),
    `</dl>`,
  ].join("");
}

function formatAlignmentBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${Math.round(value)} ${units[unitIndex]}`;
}

function renderDetailGroup(title, count, body, open = false) {
  const countHtml = count === "" || count == null
    ? ""
    : `<span class="elf-detail-count app-data-text">${escapeHtml(String(count))}</span>`;
  return [
    `<details class="elf-detail-group" ${open ? "open" : ""}>`,
    `<summary><span>${escapeHtml(title)}</span>${countHtml}</summary>`,
    `<div class="elf-detail-group-body">${body}</div>`,
    `</details>`,
  ].join("");
}

function renderKeyValueRows(rows, t) {
  return [
    `<dl class="elf-detail-kv">`,
    rows.map(([label, value]) => [
      `<div>`,
      `<dt>${escapeHtml(label)}</dt>`,
      `<dd class="app-data-text">${escapeHtml(String(value ?? t("unknown")))}</dd>`,
      `</div>`,
    ].join("")).join(""),
    `</dl>`,
  ].join("");
}

function renderDynamicContent(dynamic, total, t, truncated) {
  const chips = Array.isArray(dynamic?.needed) && dynamic.needed.length > 0
    ? `<div class="elf-detail-chip-list">${dynamic.needed.map((item) => `<code class="app-data-text">${escapeHtml(item)}</code>`).join("")}</div>`
    : `<p class="elf-detail-empty">${escapeHtml(t("elfNoEntries"))}</p>`;
  const identity = [
    dynamic?.soname ? ["SONAME", dynamic.soname] : null,
    dynamic?.rpath ? ["RPATH", dynamic.rpath] : null,
    dynamic?.runpath ? ["RUNPATH", dynamic.runpath] : null,
  ].filter(Boolean);

  return [
    identity.length > 0 ? renderKeyValueRows(identity, t) : "",
    `<h4>${escapeHtml(t("elfNeededLibraries"))}</h4>`,
    chips,
    renderDataTable(t("elfDynamicLinks"), [
      ["#", "index"],
      ["Section", "section"],
      ["Tag", "tag"],
      ["Value", "value"],
      ["Text", "text"],
    ], dynamic?.entries, total, DYNAMIC_RENDER_LIMIT, t, truncated),
  ].join("");
}

function renderDataTable(label, columns, rows, total, limit, t, truncated = false) {
  const values = Array.isArray(rows) ? rows : [];
  if (values.length === 0) {
    return `<p class="elf-detail-empty">${escapeHtml(t("elfNoEntries"))}</p>`;
  }
  const visible = values.slice(0, limit);
  const expectedTotal = Math.max(Number(total) || 0, values.length);
  const wasTruncated = truncated || expectedTotal > visible.length;
  return [
    `<div class="elf-detail-table-region" role="region" aria-label="${escapeAttr(label)}" tabindex="0">`,
    `<table class="elf-detail-table">`,
    `<thead><tr>${columns.map(([column]) => `<th scope="col">${escapeHtml(column)}</th>`).join("")}</tr></thead>`,
    `<tbody>`,
    visible.map((row) => `<tr>${columns.map(([, key]) => `<td class="app-data-text">${escapeHtml(String(row?.[key] ?? ""))}</td>`).join("")}</tr>`).join(""),
    `</tbody>`,
    `</table>`,
    `</div>`,
    wasTruncated
      ? `<p class="elf-detail-truncated">${escapeHtml(t("elfDetailsTruncated", { count: visible.length, total: expectedTotal }))}</p>`
      : "",
  ].join("");
}
