import { escapeAttr, escapeHtml } from "./html.js";
import { clamp } from "./math.js";
import { formatBytes, getInitial, sanitizeImageSrc } from "./format.js";
import { COMPONENT_SECTIONS, getStats } from "./report-model.js";
import { buildHistorySummary } from "./history.js";
import { hydrateReportSdkIcons } from "./sdk-icon-cache.js";
import { renderSdkInline as renderSdkInlineBase } from "./sdk-icon-renderer.js";
import { detectTerminalSystem } from "./system.js";

const COMPARE_SLOT_KEYS = ["left", "right"];
const fineHoverMedia = window.matchMedia("(hover: hover) and (pointer: fine)");

export class CompareController {
  constructor(options) {
    this.elements = options.elements;
    this.translate = options.t;
    this.getLocale = options.getLocale;
    this.getHistory = options.getHistory;
    this.ensureWorker = options.ensureWorker;
    this.createJob = options.createJob;
    this.deleteJob = options.deleteJob;
    this.hasJob = options.hasJob;
    this.updateClearButton = options.updateClearButton;
    this.slots = {
      left: createCompareSlotState(),
      right: createCompareSlotState(),
    };
  }

  t(key, variables = {}) {
    return this.translate(key, variables);
  }

  bindEvents() {
    this.elements.fileInputs.forEach((input) => {
      input.addEventListener("change", () => {
        this.analyzeFile(input.dataset.compareFile, input.files?.[0] || null);
      });
    });

    const clearTouchDropZonePointerState = (event) => {
      if (!shouldClearPointerHighlightOnRelease(event)) {
        return;
      }

      clearDropZonePointerState(this.elements.dropZones);
    };

    this.elements.dropZones.forEach((zone) => {
      const activatePointer = (event) => {
        updateDropZonePointer(event, zone);
        if (shouldActivatePointerHighlight(event)) {
          zone.classList.add("is-pointer-active");
        }
      };

      zone.addEventListener("pointerdown", activatePointer);
      zone.addEventListener("pointerenter", activatePointer);
      zone.addEventListener("pointermove", activatePointer);
      zone.addEventListener("pointerleave", () => {
        zone.classList.remove("is-pointer-active");
      });
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        updateDropZonePointer(event, zone);
        zone.classList.add("is-dragging");
      });
      zone.addEventListener("dragleave", () => {
        zone.classList.remove("is-dragging");
      });
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        zone.classList.remove("is-dragging");
        this.analyzeFile(zone.dataset.compareDrop, event.dataTransfer?.files?.[0] || null);
      });
    });

    document.addEventListener("pointerup", clearTouchDropZonePointerState);
    document.addEventListener("pointercancel", clearTouchDropZonePointerState);
    window.addEventListener("blur", () => {
      clearDropZonePointerState(this.elements.dropZones);
    });

    this.elements.historySelects.forEach((select) => {
      select.addEventListener("change", () => {
        this.setSlotFromHistory(select.dataset.compareHistory, select.value);
      });
    });

    this.elements.clearButtons.forEach((button) => {
      button.addEventListener("click", () => {
        this.clearSlot(button.dataset.compareClear);
      });
    });
  }

  setVisible(isVisible) {
    this.elements.view.hidden = !isVisible;
    if (isVisible) {
      this.renderPage();
    }
  }

  hasContent() {
    return COMPARE_SLOT_KEYS.some((slotKey) => {
      const slot = this.slots[slotKey];
      return slot.report || slot.status === "busy" || slot.error;
    });
  }

  renderPage() {
    this.renderHistoryOptions();
    this.renderSlots();
    this.renderWarning();
    this.renderResult();
    this.updateClearButton();
  }

  renderHistoryOptions() {
    const history = this.getHistory();
    this.elements.historySelects.forEach((select) => {
      const slot = this.getSlot(select.dataset.compareHistory);
      const selectedId = slot?.historyId || "";
      const options = [
        `<option value="">${escapeHtml(this.t("compareHistoryPlaceholder"))}</option>`,
        ...history.map((entry) => {
          const summary = entry.summary || buildHistorySummary(entry.report);
          const title = summary.appName || summary.packageName || this.t("unknown");
          const version = summary.versionName || summary.versionCode || this.t("unknown");
          const label = `${title} · ${summary.packageName || this.t("unknown")} · ${version}`;
          const selected = entry.id === selectedId ? " selected" : "";
          return `<option value="${escapeAttr(entry.id)}"${selected}>${escapeHtml(label)}</option>`;
        }),
      ];
      select.innerHTML = options.join("");
    });
  }

  async setSlotFromHistory(slotKey, historyId) {
    const slot = this.getSlot(slotKey);
    if (!slot) {
      return;
    }

    if (!historyId) {
      this.clearSlot(slotKey);
      return;
    }

    const entry = this.getHistory().find((item) => item.id === historyId);
    if (!entry?.report) {
      return;
    }

    if (slot.jobId != null) {
      this.deleteJob(slot.jobId);
    }

    const summary = entry.summary || buildHistorySummary(entry.report);
    Object.assign(slot, {
      report: await hydrateReportSdkIcons(entry.report),
      source: "history",
      historyId,
      fileName: summary.fileName || "",
      fileSizeBytes: summary.fileSizeBytes || 0,
      status: "ready",
      progressKey: "",
      error: "",
      jobId: null,
    });
    this.renderPage();
  }

  async analyzeFile(slotKey, file) {
    const slot = this.getSlot(slotKey);
    if (!slot || !file) {
      return;
    }

    if (slot.jobId != null) {
      this.deleteJob(slot.jobId);
    }

    if (!isLikelyApk(file)) {
      Object.assign(slot, {
        report: null,
        source: "upload",
        historyId: "",
        fileName: file.name || "",
        fileSizeBytes: file.size || 0,
        status: "error",
        progressKey: "",
        error: this.t("invalidFile"),
        jobId: null,
      });
      this.renderPage();
      return;
    }

    const worker = this.ensureWorker();
    if (!worker) {
      Object.assign(slot, {
        report: null,
        source: "upload",
        historyId: "",
        fileName: file.name || "",
        fileSizeBytes: file.size || 0,
        status: "error",
        progressKey: "",
        error: this.t("workerFailed"),
        jobId: null,
      });
      this.renderPage();
      return;
    }

    const jobId = this.createJob({
      type: "compare",
      slotKey,
    });
    Object.assign(slot, {
      report: null,
      source: "upload",
      historyId: "",
      fileName: file.name || "local.apk",
      fileSizeBytes: file.size || 0,
      status: "busy",
      progressKey: "progressReading",
      error: "",
      jobId,
    });
    this.renderPage();

    const terminalSystem = await detectTerminalSystem();
    if (slot.jobId !== jobId || !this.hasJob(jobId)) {
      return;
    }

    worker.postMessage({
      type: "analyze",
      jobId,
      locale: this.getLocale(),
      file,
      terminalSystem,
    });
  }

  handleProgress(slotKey, jobId, progressKey) {
    const slot = this.getSlot(slotKey);
    if (slot?.jobId !== jobId) {
      return;
    }

    slot.progressKey = progressKey;
    this.renderPage();
  }

  finishJob(slotKey, report, error) {
    const slot = this.getSlot(slotKey);
    if (!slot) {
      return;
    }

    if (error) {
      Object.assign(slot, {
        report: null,
        status: "error",
        progressKey: "",
        error,
        jobId: null,
      });
    } else {
      Object.assign(slot, {
        report,
        status: "ready",
        progressKey: "",
        error: "",
        jobId: null,
        fileName: report?.fileName || slot.fileName,
        fileSizeBytes: report?.fileSizeBytes || slot.fileSizeBytes,
      });
    }

    this.renderPage();
  }

  clearSlot(slotKey) {
    const slot = this.getSlot(slotKey);
    if (!slot) {
      return;
    }

    if (slot.jobId != null) {
      this.deleteJob(slot.jobId);
    }

    this.slots[slotKey] = createCompareSlotState();
    const input = this.elements.fileInputs.find((item) => item.dataset.compareFile === slotKey);
    if (input) {
      input.value = "";
    }
    this.renderPage();
  }

  reset() {
    for (const slotKey of COMPARE_SLOT_KEYS) {
      const slot = this.slots[slotKey];
      if (slot.jobId != null) {
        this.deleteJob(slot.jobId);
      }
      this.slots[slotKey] = createCompareSlotState();
    }

    this.elements.fileInputs.forEach((input) => {
      input.value = "";
    });
    this.renderPage();
  }

  getSlot(slotKey) {
    return COMPARE_SLOT_KEYS.includes(slotKey) ? this.slots[slotKey] : null;
  }

  renderSlots() {
    for (const slotKey of COMPARE_SLOT_KEYS) {
      const slot = this.slots[slotKey];
      const meta = document.querySelector(`[data-compare-file-meta="${slotKey}"]`);
      const reportNode = document.querySelector(`[data-compare-slot-report="${slotKey}"]`);
      const clearButton = this.elements.clearButtons.find((button) => button.dataset.compareClear === slotKey);

      if (meta) {
        meta.textContent = this.getSlotMeta(slot);
      }
      if (reportNode) {
        reportNode.innerHTML = this.renderSlotReport(slot);
      }
      if (clearButton) {
        clearButton.disabled = !slot.report && slot.status !== "busy" && !slot.error;
      }
    }
  }

  getSlotMeta(slot) {
    if (slot.status === "busy") {
      return this.t(slot.progressKey || "progressReading");
    }
    if (slot.status === "error") {
      return slot.error || this.t("unknownError");
    }
    if (slot.report) {
      return this.t("compareSlotReady", {
        name: slot.fileName || slot.report.fileName || "local.apk",
        size: formatBytes(slot.fileSizeBytes || slot.report.fileSizeBytes || 0),
      });
    }
    return this.t("compareSlotEmpty");
  }

  renderSlotReport(slot) {
    if (slot.status === "busy") {
      return [
        `<div class="compare-slot-status is-busy">`,
        `<span>${escapeHtml(this.t(slot.progressKey || "progressReading"))}</span>`,
        `<span class="compare-spinner" aria-hidden="true"></span>`,
        `</div>`,
      ].join("");
    }

    if (slot.status === "error") {
      return `<div class="alert compare-slot-alert">${escapeHtml(slot.error || this.t("unknownError"))}</div>`;
    }

    if (!slot.report) {
      return emptyList(this.t("compareSlotEmptyHint"));
    }

    const info = slot.report.apkInfo || {};
    const stats = getStats(info);
    const sourceLabel = slot.source === "history" ? this.t("compareSourceHistory") : this.t("compareSourceUpload");
    return [
      `<div class="compare-app-card">`,
      this.renderAppIcon(info),
      `<div class="compare-app-copy">`,
      `<h3>${escapeHtml(info.appName || this.t("unknown"))}</h3>`,
      `<code>${escapeHtml(info.packageName || this.t("unknown"))}</code>`,
      `<div class="hero-meta">`,
      chip(`${this.t("versionName")}: ${info.versionName || this.t("unknown")}`, this.t("unknown")),
      chip(`${this.t("versionCode")}: ${info.versionCode || this.t("unknown")}`, this.t("unknown")),
      chip(sourceLabel, this.t("unknown")),
      `</div>`,
      `<div class="compare-stat-strip">`,
      compareMiniStat(this.t("permissions"), stats.permissions),
      compareMiniStat(this.t("nativeLibraries"), stats.nativeLibraries),
      compareMiniStat(this.t("components"), stats.components),
      `</div>`,
      `</div>`,
      `</div>`,
    ].join("");
  }

  renderWarning() {
    const left = this.slots.left.report;
    const right = this.slots.right.report;
    const leftPackage = left?.apkInfo?.packageName || "";
    const rightPackage = right?.apkInfo?.packageName || "";
    const shouldWarn = Boolean(leftPackage && rightPackage && leftPackage !== rightPackage);

    this.elements.warning.hidden = !shouldWarn;
    this.elements.warning.textContent = shouldWarn
      ? this.t("comparePackageMismatch", { left: leftPackage, right: rightPackage })
      : "";
  }

  renderResult() {
    const left = this.slots.left.report;
    const right = this.slots.right.report;
    if (!left && !right) {
      this.elements.result.innerHTML = "";
      return;
    }

    if (!left || !right) {
      this.elements.result.innerHTML = emptyList(this.t("compareAwaitingPair"));
      return;
    }

    this.elements.result.innerHTML = this.renderReport(left, right);
  }

  renderReport(leftReport, rightReport) {
    const summaryRows = this.buildSummaryRows(leftReport, rightReport);
    const sections = this.buildSections(leftReport, rightReport);
    const totalChanges = sections.reduce((sum, sectionItem) => sum + getSectionChangeCount(sectionItem), 0);

    return sectionStack([
      `<section class="compare-overview">`,
      metric(this.t("compareChangeCount"), totalChanges),
      metric(this.t("permissions"), compareDeltaCount(leftReport, rightReport, "permissions")),
      metric(this.t("nativeLibraries"), compareDeltaCount(leftReport, rightReport, "nativeLibraries")),
      metric(this.t("components"), compareDeltaCount(leftReport, rightReport, "components")),
      `</section>`,
      section(this.t("compareBasicInfo"), this.renderValueTable(summaryRows)),
      section(this.t("compareDifferences"), totalChanges ? this.renderDiffSections(sections) : emptyList(this.t("compareNoDifferences"))),
    ]);
  }

  buildSummaryRows(leftReport, rightReport) {
    const leftInfo = leftReport.apkInfo || {};
    const rightInfo = rightReport.apkInfo || {};
    const leftStats = getStats(leftInfo);
    const rightStats = getStats(rightInfo);
    const leftSdkCount = countSdkMarkers(leftInfo.sdkSummary);
    const rightSdkCount = countSdkMarkers(rightInfo.sdkSummary);

    return [
      [this.t("appName"), leftInfo.appName, rightInfo.appName],
      [this.t("packageName"), leftInfo.packageName, rightInfo.packageName],
      [this.t("versionName"), leftInfo.versionName, rightInfo.versionName],
      [this.t("versionCode"), leftInfo.versionCode, rightInfo.versionCode],
      [this.t("targetSdk"), leftInfo.targetSdk, rightInfo.targetSdk],
      [this.t("minSdk"), leftInfo.minSdk, rightInfo.minSdk],
      [this.t("compileSdk"), leftInfo.compileSdk, rightInfo.compileSdk],
      [this.t("fileName"), leftReport.fileName, rightReport.fileName],
      [this.t("fileSize"), formatBytes(leftReport.fileSizeBytes), formatBytes(rightReport.fileSizeBytes)],
      [this.t("permissions"), leftStats.permissions, rightStats.permissions],
      [this.t("nativeLibraries"), leftStats.nativeLibraries, rightStats.nativeLibraries],
      [this.t("components"), leftStats.components, rightStats.components],
      [this.t("sdk"), leftSdkCount, rightSdkCount],
      [this.t("signatures"), leftStats.signatures, rightStats.signatures],
      [this.t("metaData"), leftStats.metaData, rightStats.metaData],
    ];
  }

  renderValueTable(rows) {
    return [
      `<div class="compare-table">`,
      `<div class="compare-table-row compare-table-head">`,
      `<div>${escapeHtml(this.t("compareField"))}</div>`,
      `<div>${escapeHtml(this.t("compareLeft"))}</div>`,
      `<div>${escapeHtml(this.t("compareRight"))}</div>`,
      `</div>`,
      rows.map(([label, left, right]) => {
        const leftValue = this.formatValue(left);
        const rightValue = this.formatValue(right);
        const changed = leftValue !== rightValue ? " is-changed" : "";
        return [
          `<div class="compare-table-row${changed}">`,
          `<div>${escapeHtml(label)}</div>`,
          `<div>${escapeHtml(leftValue)}</div>`,
          `<div>${escapeHtml(rightValue)}</div>`,
          `</div>`,
        ].join("");
      }).join(""),
      `</div>`,
    ].join("");
  }

  formatValue(value) {
    if (value == null || value === "") {
      return this.t("unknown");
    }
    return String(value);
  }

  buildSections(leftReport, rightReport) {
    const sectionInputs = [
      [this.t("buildFeatures"), (report) => this.getFeatureItems(report)],
      [this.t("sdk"), (report) => this.getSdkItems(report)],
      [this.t("nativeLibraries"), (report) => this.getNativeItems(report)],
      [this.t("components"), (report) => this.getComponentItems(report)],
      [this.t("permissions"), (report) => this.getPermissionItems(report)],
      [this.t("signatures"), (report) => this.getSignatureItems(report)],
      [this.t("metaData"), (report) => this.getMetaDataItems(report)],
    ];

    return sectionInputs
      .map(([title, getter]) => {
        const diff = diffCompareItems(getter(leftReport), getter(rightReport), (left, right) => this.renderPairMeta(left, right));
        return {
          title,
          ...diff,
        };
      })
      .filter((sectionItem) => getSectionChangeCount(sectionItem) > 0);
  }

  renderDiffSections(sections) {
    return sections.map((sectionItem) => {
      const leftCount = sectionItem.leftOnly.length;
      const rightCount = sectionItem.rightOnly.length;
      const changedCount = sectionItem.changed.length;
      const movedCount = sectionItem.moved.length;
      const hasSideDiffs = leftCount > 0 || rightCount > 0;
      return [
        `<details class="group-block compare-diff-block" open>`,
        `<summary class="component-group-summary">`,
        `<span class="component-group-title">${escapeHtml(sectionItem.title)}</span>`,
        `<span class="component-group-count">${escapeHtml(String(getSectionChangeCount(sectionItem)))}</span>`,
        `</summary>`,
        hasSideDiffs ? [
          `<div class="compare-diff-columns">`,
          this.renderDiffColumn(this.t("compareOnlyLeft"), sectionItem.leftOnly),
          this.renderDiffColumn(this.t("compareOnlyRight"), sectionItem.rightOnly),
          `</div>`,
        ].join("") : "",
        changedCount ? this.renderDiffGroup(this.t("compareChanged"), sectionItem.changed) : "",
        movedCount ? this.renderDiffGroup(this.t("compareMoved"), sectionItem.moved) : "",
        `</details>`,
      ].join("");
    }).join("");
  }

  renderDiffColumn(title, items) {
    return [
      `<section class="compare-diff-column">`,
      `<h4>${escapeHtml(title)} <span>${escapeHtml(String(items.length))}</span></h4>`,
      this.renderItemList(items),
      `</section>`,
    ].join("");
  }

  renderDiffGroup(title, items) {
    return [
      `<section class="compare-diff-pair-group">`,
      `<h4>${escapeHtml(title)} <span>${escapeHtml(String(items.length))}</span></h4>`,
      this.renderItemList(items),
      `</section>`,
    ].join("");
  }

  renderItemList(items) {
    if (!items.length) {
      return emptyList(this.t("compareNoItems"));
    }

    const visibleItems = items.slice(0, 80);
    const rows = visibleItems.map((item) => this.renderDiffItem(item)).join("");
    const overflow = items.length > visibleItems.length
      ? `<p class="compare-overflow-note">${escapeHtml(this.t("compareMoreItems", { count: items.length - visibleItems.length }))}</p>`
      : "";

    return `<div class="compare-diff-list">${rows}${overflow}</div>`;
  }

  renderDiffItem(item) {
    const status = item.status || "";
    const statusLabel = this.getStatusLabel(status);
    return [
      `<article class="compare-diff-item${status ? ` is-${escapeAttr(status)}` : ""}">`,
      `<div class="compare-diff-item-header">`,
      `<strong>${item.labelHtml || escapeHtml(item.label || item.key || this.t("unknown"))}</strong>`,
      statusLabel ? `<span class="compare-diff-status">${escapeHtml(statusLabel)}</span>` : "",
      `</div>`,
      item.metaHtml || item.meta ? `<span>${item.metaHtml || escapeHtml(item.meta)}</span>` : "",
      `</article>`,
    ].join("");
  }

  getStatusLabel(status) {
    const labels = {
      added: "compareAdded",
      deleted: "compareDeleted",
      changed: "compareChanged",
      moved: "compareMoved",
    };
    return labels[status] ? this.t(labels[status]) : "";
  }

  getFeatureItems(report) {
    const features = report.apkInfo?.buildFeatures || {};
    const items = [];
    if (features.kotlinDetected) {
      items.push(compareItem(`kotlin:${features.kotlinVersion || ""}`, buildFeatureLabel("Kotlin", features.kotlinVersion), "", {
        identityKey: "kotlin",
        pairValue: features.kotlinVersion || this.t("unknown"),
      }));
    }
    if (features.composeDetected) {
      items.push(compareItem(`compose:${features.composeVersion || ""}`, buildFeatureLabel("Compose", features.composeVersion), "", {
        identityKey: "compose",
        pairValue: features.composeVersion || this.t("unknown"),
      }));
    }
    if (features.gradleVersion) {
      items.push(compareItem(`gradle:${features.gradleVersion}`, `Gradle ${features.gradleVersion}`, "", {
        identityKey: "gradle",
        pairValue: features.gradleVersion,
      }));
    }
    if (features.agpVersion) {
      items.push(compareItem(`agp:${features.agpVersion}`, `AGP ${features.agpVersion}`, "", {
        identityKey: "agp",
        pairValue: features.agpVersion,
      }));
    }
    if (features.appMetadataVersion) {
      items.push(compareItem(`app-metadata:${features.appMetadataVersion}`, `App Metadata ${features.appMetadataVersion}`, "", {
        identityKey: "app-metadata",
        pairValue: features.appMetadataVersion,
      }));
    }
    return items;
  }

  getSdkItems(report) {
    const sdkSummary = report.apkInfo?.sdkSummary || {};
    return [
      ...(sdkSummary.native || []).map((item) => {
        const sdk = this.withSdkLabelFallback(item);
        return compareItem(
          `native:${sdk.label || sdk.iconName || sdk.name || ""}:${sdk.count || 0}`,
          sdk.label || sdk.iconName || this.t("unknown"),
          `${this.t("nativeLibraries")} · ${sdk.count || 0}`,
          {
            identityKey: `native:${sdk.label || sdk.iconName || sdk.name || ""}`,
            labelHtml: this.renderSdkInline(sdk),
            pairValue: String(sdk.count || 0),
          },
        );
      }),
      ...(sdkSummary.components || []).map((item) => {
        const sdk = this.withSdkLabelFallback(item);
        return compareItem(
          `components:${sdk.label || sdk.iconName || sdk.name || ""}:${sdk.count || 0}`,
          sdk.label || sdk.iconName || this.t("unknown"),
          `${this.t("components")} · ${sdk.count || 0}`,
          {
            identityKey: `components:${sdk.label || sdk.iconName || sdk.name || ""}`,
            labelHtml: this.renderSdkInline(sdk),
            pairValue: String(sdk.count || 0),
          },
        );
      }),
    ];
  }

  withSdkLabelFallback(sdk) {
    return {
      ...sdk,
      label: sdk?.label || sdk?.iconName || sdk?.name || this.t("unknown"),
    };
  }

  getNativeItems(report) {
    return (report.apkInfo?.nativeLibraries || []).map((library) => compareItem(
      `${library.abi || ""}/${library.name || ""}:${library.size || 0}:${library.sdk?.label || ""}`,
      library.name || this.t("unknown"),
      [library.abi, formatBytes(library.size || 0), library.sdk?.label].filter(Boolean).join(" · "),
      {
        identityKey: `${library.abi || ""}/${library.name || ""}`,
        metaHtml: this.renderMetaParts([
          library.abi,
          formatBytes(library.size || 0),
          library.sdk ? { html: this.renderSdkInline(library.sdk) } : null,
        ]),
        pairValue: [library.abi, formatBytes(library.size || 0), library.sdk?.label].filter(Boolean).join(" · "),
        pairValueHtml: this.renderMetaParts([
          library.abi,
          formatBytes(library.size || 0),
          library.sdk ? { html: this.renderSdkInline(library.sdk) } : null,
        ]),
      },
    ));
  }

  getComponentItems(report) {
    const components = report.apkInfo?.components || {};
    return COMPONENT_SECTIONS.flatMap((sectionName) => (components[sectionName] || []).map((component) => {
      const name = component.name || this.t("unknown");
      const simpleName = getComponentSimpleName(component.name);
      const signature = getComponentCompareSignature(component);
      return compareItem(
        `${sectionName}:${name}:${signature}`,
        name,
        [this.t(sectionName), component.sdk?.label, component.permission].filter(Boolean).join(" · "),
        {
          identityKey: `${sectionName}:${name}`,
          moveKey: simpleName ? `${sectionName}:${simpleName}` : "",
          moveLabel: simpleName || name,
          metaHtml: this.renderMetaParts([
            this.t(sectionName),
            component.sdk ? { html: this.renderSdkInline(component.sdk) } : null,
            component.permission,
          ]),
          pairValue: name,
        },
      );
    }));
  }

  getPermissionItems(report) {
    return (report.apkInfo?.permissions || []).map((permission) => compareItem(permission, permission));
  }

  getSignatureItems(report) {
    return (report.apkInfo?.signatures?.certificates || []).map((certificate, index) => {
      const fingerprint = certificate.fingerprints?.sha256 || certificate.fingerprints?.sha1 || certificate.charString || `${index}`;
      return compareItem(
        fingerprint,
        fingerprint,
        (certificate.schemes || []).join(", "),
      );
    });
  }

  getMetaDataItems(report) {
    return (report.apkInfo?.metaData?.application || []).map((item) => compareItem(
      `${item.name || ""}:${item.value || ""}:${item.resourceId || ""}`,
      item.name || this.t("unknown"),
      item.value || "",
      {
        identityKey: item.name || "",
        pairValue: item.value || this.t("unknown"),
      },
    ));
  }

  renderMetaParts(parts) {
    return parts
      .map((part) => {
        if (!part) {
          return "";
        }
        if (typeof part === "object" && part.html) {
          return String(part.html);
        }
        return escapeHtml(String(part));
      })
      .filter(Boolean)
      .join(`<span class="compare-diff-meta-separator" aria-hidden="true"> · </span>`);
  }

  renderPairMeta(left, right) {
    return [
      `<span class="compare-diff-pair-value">${left.pairValueHtml || escapeHtml(left.pairValue || left.meta || left.label || this.t("unknown"))}</span>`,
      `<span class="compare-diff-arrow" aria-hidden="true">→</span>`,
      `<span class="compare-diff-pair-value">${right.pairValueHtml || escapeHtml(right.pairValue || right.meta || right.label || this.t("unknown"))}</span>`,
    ].join("");
  }

  renderSdkInline(sdk) {
    return renderSdkInlineBase(sdk, this.t("unknown"));
  }

  renderAppIcon(info) {
    const src = sanitizeImageSrc(info.icon?.dataUri || "");
    if (src) {
      return `<img class="app-icon" src="${escapeAttr(src)}" alt="${escapeAttr(info.appName || this.t("appName"))}">`;
    }

    return `<div class="app-icon-placeholder" aria-hidden="true">${escapeHtml(getInitial(info.appName || info.packageName))}</div>`;
  }
}

function createCompareSlotState() {
  return {
    report: null,
    source: "",
    historyId: "",
    fileName: "",
    fileSizeBytes: 0,
    status: "empty",
    progressKey: "",
    error: "",
    jobId: null,
  };
}

function updateDropZonePointer(event, zone) {
  const rect = zone.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  zone.style.setProperty("--drop-x", `${x.toFixed(1)}px`);
  zone.style.setProperty("--drop-y", `${y.toFixed(1)}px`);
}

function clearDropZonePointerState(zones) {
  zones.forEach((zone) => {
    zone.classList.remove("is-pointer-active");
  });
}

function shouldActivatePointerHighlight(event) {
  return event.type === "pointerdown" || isFineHoverPointer(event);
}

function shouldClearPointerHighlightOnRelease(event) {
  return !isFineHoverPointer(event);
}

function isFineHoverPointer(event) {
  return event.pointerType === "mouse" && fineHoverMedia.matches;
}

function compareMiniStat(label, value) {
  return [
    `<span class="compare-mini-stat">`,
    `<span>${escapeHtml(label)}</span>`,
    `<strong>${escapeHtml(String(value || 0))}</strong>`,
    `</span>`,
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

function chip(value, unknownLabel) {
  return `<span class="chip">${escapeHtml(value || unknownLabel)}</span>`;
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

function countSdkMarkers(sdkSummary = {}) {
  return (sdkSummary.native?.length || 0) + (sdkSummary.components?.length || 0);
}

function getSectionChangeCount(sectionItem) {
  return (
    sectionItem.leftOnly.length +
    sectionItem.rightOnly.length +
    sectionItem.changed.length +
    sectionItem.moved.length
  );
}

function diffCompareItems(leftItems, rightItems, renderPairMeta) {
  const exact = partitionCompareMatches(leftItems, rightItems, (item) => item.key);
  const changed = partitionCompareMatches(exact.leftRest, exact.rightRest, (item) => item.identityKey);
  const moved = partitionCompareMatches(changed.leftRest, changed.rightRest, (item) => item.moveKey);

  return {
    leftOnly: changedItemsWithStatus(moved.leftRest, "deleted").sort(compareItemsByLabel),
    rightOnly: changedItemsWithStatus(moved.rightRest, "added").sort(compareItemsByLabel),
    changed: changed.pairs.map(([left, right]) => comparePairItem(left, right, "changed", renderPairMeta)).sort(compareItemsByLabel),
    moved: moved.pairs.map(([left, right]) => comparePairItem(left, right, "moved", renderPairMeta)).sort(compareItemsByLabel),
  };
}

function partitionCompareMatches(leftItems, rightItems, keySelector) {
  const rightBuckets = new Map();
  rightItems.forEach((item, index) => {
    const key = String(keySelector(item) || "");
    if (!key) {
      return;
    }
    const bucket = rightBuckets.get(key) || [];
    bucket.push({ item, index });
    rightBuckets.set(key, bucket);
  });

  const pairs = [];
  const leftRest = [];
  const usedRightIndexes = new Set();

  leftItems.forEach((left) => {
    const key = String(keySelector(left) || "");
    const bucket = key ? rightBuckets.get(key) : null;
    const match = bucket?.find((entry) => !usedRightIndexes.has(entry.index));
    if (!match) {
      leftRest.push(left);
      return;
    }

    usedRightIndexes.add(match.index);
    pairs.push([left, match.item]);
  });

  return {
    pairs,
    leftRest,
    rightRest: rightItems.filter((_, index) => !usedRightIndexes.has(index)),
  };
}

function changedItemsWithStatus(items, status) {
  return items.map((item) => ({
    ...item,
    status,
  }));
}

function comparePairItem(left, right, status, renderPairMeta) {
  const label = status === "moved"
    ? right.moveLabel || left.moveLabel || right.label || left.label
    : right.label || left.label;
  const labelHtml = status === "moved"
    ? right.moveLabelHtml || left.moveLabelHtml || ""
    : right.labelHtml || left.labelHtml || "";

  return {
    key: `${status}:${left.key}->${right.key}`,
    label,
    labelHtml,
    meta: `${left.pairValue || left.meta || left.label} -> ${right.pairValue || right.meta || right.label}`,
    metaHtml: renderPairMeta(left, right),
    status,
  };
}

function compareItemsByLabel(left, right) {
  return String(left.label || left.key || "").localeCompare(String(right.label || right.key || ""), "en", {
    sensitivity: "base",
  });
}

function compareDeltaCount(leftReport, rightReport, statsKey) {
  const leftStats = getStats(leftReport.apkInfo || {});
  const rightStats = getStats(rightReport.apkInfo || {});
  const delta = (rightStats[statsKey] || 0) - (leftStats[statsKey] || 0);
  return delta === 0 ? "0" : delta > 0 ? `+${delta}` : String(delta);
}

function getComponentSimpleName(name = "") {
  const value = String(name || "").trim();
  if (!value) {
    return "";
  }
  const dotIndex = value.lastIndexOf(".");
  return dotIndex >= 0 ? value.slice(dotIndex + 1) : value;
}

function getComponentCompareSignature(component) {
  return [
    component.sdk?.label || "",
    component.permission || "",
    component.process || "",
    component.authorities || "",
    component.targetActivity || "",
    ...(component.actions || []),
  ].join("|");
}

function compareItem(key, label, meta = "", options = {}) {
  return {
    key: String(key || label || ""),
    label: String(label || key || ""),
    meta: String(meta || ""),
    identityKey: String(options.identityKey || ""),
    moveKey: String(options.moveKey || ""),
    moveLabel: String(options.moveLabel || ""),
    moveLabelHtml: String(options.moveLabelHtml || ""),
    labelHtml: String(options.labelHtml || ""),
    metaHtml: String(options.metaHtml || ""),
    pairValue: String(options.pairValue || ""),
    pairValueHtml: String(options.pairValueHtml || ""),
  };
}
