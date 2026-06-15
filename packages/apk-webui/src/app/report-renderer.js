import { escapeAttr, escapeHtml } from "./html.js";
import { formatBytes, formatResourceId, getInitial, sanitizeFilePart, sanitizeImageSrc, stripDataUris } from "./format.js";
import { COMPONENT_SECTIONS, countComponents, getStats, groupBy } from "./report-model.js";
const ARCHIVE_CHART_CENTER = 60;
const ARCHIVE_CHART_RADIUS = 52;
const ARCHIVE_CHART_LABEL_MIN_PERCENT = 6;
const ARCHIVE_CHART_SEGMENT_LIFT = 5;
const NATIVE_PAGE_SIZE_16_KB = 0x4000;
const ARCHIVE_CHART_COLORS = [
  "#38bdf8",
  "#22c55e",
  "#f97316",
  "#eab308",
  "#a78bfa",
  "#f43f5e",
  "#14b8a6",
  "#64748b",
  "#d946ef",
  "#84cc16",
];
let runtime = null;
let state = null;
let t = () => "";
let formatDate = () => "";
let trackWebEvent = () => {};
let getReportAnalyticsFields = () => ({});
const exportJsonCache = new WeakMap();

export function configureReportRenderer(options) {
  runtime = options.runtime;
  state = options.state;
  t = options.t;
  formatDate = options.formatDate;
  trackWebEvent = options.trackWebEvent;
  getReportAnalyticsFields = options.getReportAnalyticsFields;
}

export function downloadReport(report, json = "") {
  trackWebEvent("webui.report.exported", {
    result: "success",
    operation: "json_export",
    ...getReportAnalyticsFields(report),
  });

  const data = json || formatExportJson(report);
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

export function clearExportJsonCache(report) {
  exportJsonCache.delete(report);
}

export function renderTabPanelHtml(report) {
  if (!report) {
    return "";
  }

  if (state.activeTab === "sdk") {
    return renderSdkTab(report);
  }
  if (state.activeTab === "native") {
    return renderNativeTab(report);
  }
  if (state.activeTab === "components") {
    return renderComponentsTab(report);
  }
  if (state.activeTab === "permissions") {
    return renderPermissionsTab(report);
  }
  if (state.activeTab === "signatures") {
    return renderSignaturesTab(report);
  }
  if (state.activeTab === "metadata") {
    return renderMetaDataTab(report);
  }
  if (state.activeTab === "raw") {
    return renderRawTab(report);
  }
  return renderSummaryTab(report);
}

export { renderArchiveDistribution, renderHero };
function renderHero(report) {
  const info = report.apkInfo;
  return [
    renderAppIcon(info),
    `<div class="hero-copy">`,
    renderAppTitle(info.appName || t("unknown")),
    `<div class="hero-meta">`,
    chip(info.packageName || t("unknown")),
    chip(`${t("heroVersionName")}: ${info.versionName || t("unknown")}`),
    chip(`${t("heroVersionCode")}: ${info.versionCode || t("unknown")}`),
    chip(`${t("targetSdk")}: ${info.targetSdk || t("unknown")}`),
    chip(t("localFile")),
    `</div>`,
    `</div>`,
  ].join("");
}

function renderArchiveDistribution(report) {
  const entries = getArchiveDistributionEntries(report.apkInfo?.archive);
  if (entries.length < 2) {
    return "";
  }

  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (totalSize <= 0) {
    return "";
  }

  return [
    `<section class="archive-chart" aria-label="${escapeAttr(t("archiveDistributionTitle"))}">`,
    `<div class="archive-chart-copy">`,
    `<h3>${escapeHtml(t("archiveDistributionTitle"))}</h3>`,
    `<p>${escapeHtml(t("archiveDistributionSummary", { count: entries.length, size: formatBytes(totalSize) }))}</p>`,
    `</div>`,
    `<div class="archive-chart-body">`,
    renderArchivePieChart(entries, totalSize),
    `</div>`,
    `</section>`,
  ].join("");
}

function getArchiveDistributionEntries(archive) {
  if (!archive || archive.type !== "package-container" || !Array.isArray(archive.apkEntryDetails)) {
    return [];
  }

  return archive.apkEntryDetails
    .map((entry) => {
      const path = String(entry.path || "");
      const name = String(entry.name || getFileNameFromPath(path) || t("unknown"));
      const size = Number(entry.size ?? entry.uncompressedSize ?? entry.compressedSize) || 0;
      return {
        path,
        name,
        size,
        analyzed: Boolean(entry.analyzed) || path === archive.analyzedEntry,
      };
    })
    .filter((entry) => entry.size > 0)
    .sort((left, right) => right.size - left.size || left.name.localeCompare(right.name));
}

function renderArchivePieChart(entries, totalSize) {
  let startAngle = 0;
  const segments = [];

  entries.forEach((entry, index) => {
    const percentValue = (entry.size / totalSize) * 100;
    const endAngle = index === entries.length - 1
      ? 360
      : startAngle + (entry.size / totalSize) * 360;
    const sliceAngle = endAngle - startAngle;
    const color = getArchiveChartColor(index);
    const percent = formatPercent(entry.size, totalSize);
    const size = formatBytes(entry.size);
    const angle = midAngle(startAngle, endAngle);
    const lift = getArchiveSegmentLift(angle);
    const label = renderArchivePieLabel(percent, percentValue, angle);
    const ariaLabel = `${entry.name}, ${size}, ${percent}`;

    segments.push([
      `<g class="archive-chart-segment" tabindex="0" aria-label="${escapeAttr(ariaLabel)}" data-archive-name="${escapeAttr(entry.name)}" data-archive-size="${escapeAttr(size)}" data-archive-percent="${escapeAttr(percent)}" data-archive-color="${escapeAttr(color)}" style="--archive-lift-x: ${formatSvgNumber(lift.x)}px; --archive-lift-y: ${formatSvgNumber(lift.y)}px;">`,
      `<path class="archive-chart-slice" d="${escapeAttr(describePieSlice(startAngle, endAngle))}" fill="${escapeAttr(color)}"></path>`,
      label,
      `</g>`,
    ].join(""));

    startAngle = endAngle;
  });

  return [
    `<svg class="archive-chart-pie" viewBox="0 0 120 120" role="img" aria-label="${escapeAttr(t("archiveDistributionTitle"))}">`,
    `<g class="archive-chart-slices">`,
    segments.join(""),
    `</g>`,
    `</svg>`,
  ].join("");
}

function renderArchivePieLabel(percent, percentValue, angle) {
  const fontSize = getArchiveLabelFontSize(percentValue);
  const radius = getArchiveLabelRadius(percentValue);
  if (percentValue < ARCHIVE_CHART_LABEL_MIN_PERCENT) {
    return "";
  }

  const labelPoint = polarToCartesian(angle, radius);
  return `<text class="archive-chart-label" x="${formatSvgNumber(labelPoint.x)}" y="${formatSvgNumber(labelPoint.y)}" font-size="${formatSvgNumber(fontSize)}" aria-hidden="true">${escapeHtml(percent)}</text>`;
}

function getArchiveLabelFontSize(percentValue) {
  if (percentValue >= 50) {
    return 12;
  }
  if (percentValue >= 25) {
    return 9.5;
  }
  if (percentValue >= 12) {
    return 7.2;
  }
  return 5.8;
}

function getArchiveLabelRadius(percentValue) {
  if (percentValue >= 55) {
    return 25;
  }
  if (percentValue >= 30) {
    return 34;
  }
  if (percentValue >= 12) {
    return 38;
  }
  return 42;
}

function getArchiveSegmentLift(angleDegrees) {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: ARCHIVE_CHART_SEGMENT_LIFT * Math.cos(radians),
    y: ARCHIVE_CHART_SEGMENT_LIFT * Math.sin(radians),
  };
}

function describePieSlice(startAngle, endAngle) {
  const start = polarToCartesian(startAngle, ARCHIVE_CHART_RADIUS);
  const end = polarToCartesian(endAngle, ARCHIVE_CHART_RADIUS);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${ARCHIVE_CHART_CENTER} ${ARCHIVE_CHART_CENTER}`,
    `L ${formatSvgNumber(start.x)} ${formatSvgNumber(start.y)}`,
    `A ${ARCHIVE_CHART_RADIUS} ${ARCHIVE_CHART_RADIUS} 0 ${largeArcFlag} 1 ${formatSvgNumber(end.x)} ${formatSvgNumber(end.y)}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(angleDegrees, radius) {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: ARCHIVE_CHART_CENTER + radius * Math.cos(radians),
    y: ARCHIVE_CHART_CENTER + radius * Math.sin(radians),
  };
}

function midAngle(startAngle, endAngle) {
  return startAngle + (endAngle - startAngle) / 2;
}

function getArchiveChartColor(index) {
  return ARCHIVE_CHART_COLORS[index % ARCHIVE_CHART_COLORS.length];
}

function getFileNameFromPath(path) {
  const value = String(path || "");
  let end = value.length - 1;
  while (end >= 0 && isPathSeparator(value.charCodeAt(end))) {
    end -= 1;
  }
  if (end < 0) {
    return "";
  }

  let start = end;
  while (start >= 0 && !isPathSeparator(value.charCodeAt(start))) {
    start -= 1;
  }

  return value.slice(start + 1, end + 1);
}

function isPathSeparator(charCode) {
  return charCode === 47 || charCode === 92;
}

function formatPercent(size, totalSize) {
  if (totalSize <= 0) {
    return "0%";
  }

  const percent = (size / totalSize) * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function formatSvgNumber(value) {
  return Number(value).toFixed(3).replace(/\.?0+$/u, "");
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
      `<div class="row-meta native-library-meta"><span>${escapeHtml(t("size"))}: ${escapeHtml(formatBytes(library.size || 0))}</span>${renderNativeLibraryLabels(library)}</div>`,
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

function renderNativeLibraryLabels(library) {
  const labels = [];
  if (isNativeLibraryElf16KbAligned(library)) {
    labels.push({ text: "16 KB", tone: "ok" });
  }

  const zipAlignment = Number(library.zipAlignment) || 0;
  if (zipAlignment > 0 && zipAlignment < NATIVE_PAGE_SIZE_16_KB) {
    labels.push({ text: formatNativeZipAlignmentLabel(zipAlignment), tone: "warning" });
  }

  return labels.map((label) => (
    `<span class="compare-diff-status" style="${escapeAttr(getNativeLibraryLabelStyle(label.tone))}">${escapeHtml(label.text)}</span>`
  )).join("");
}

function getNativeLibraryLabelStyle(tone) {
  const prefix = tone === "warning" ? "changed" : "added";
  return [
    `--compare-item-bg: var(--compare-${prefix}-bg)`,
    `--compare-item-border: var(--compare-${prefix}-border)`,
    `--compare-item-text: var(--compare-${prefix}-text)`,
    "margin-left: 8px",
    "max-width: none",
    "white-space: nowrap",
  ].join(";");
}

function isNativeLibraryElf16KbAligned(library) {
  if (library.elf16kbAligned === true) {
    return true;
  }

  const pageSize = Number(library.elfPageSize) || 0;
  return pageSize > 0 && pageSize % NATIVE_PAGE_SIZE_16_KB === 0;
}

function formatNativeZipAlignmentLabel(zipAlignment) {
  if (zipAlignment >= 1024 && zipAlignment % 1024 === 0) {
    return `${zipAlignment / 1024}KB ZIPALIGN`;
  }
  return `${zipAlignment}B ZIPALIGN`;
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
  return [
    `<article class="list-row component-row">`,
    `<div class="component-row-header">`,
    `<div class="component-row-main">`,
    `<div class="row-title component-row-title"><span>${escapeHtml(component.name || t("unknown"))}</span></div>`,
    `</div>`,
    `</div>`,
    renderComponentDetails(component),
    `</article>`,
  ].join("");
}

function renderComponentDetails(component) {
  let rows = "";

  if (component.sdk) {
    rows += renderComponentDetailRow(t("detectedRule"), renderSdkInline(component.sdk));
  }
  if (component.permission) {
    rows += renderComponentDetailRow(t("permission"), inlineCodeValue(component.permission));
  }
  if (component.process) {
    rows += renderComponentDetailRow(t("process"), inlineCodeValue(component.process));
  }
  if (component.authorities) {
    rows += renderComponentDetailRow(t("authorities"), inlineCodeValue(component.authorities));
  }
  if (component.targetActivity) {
    rows += renderComponentDetailRow(t("targetActivity"), inlineCodeValue(component.targetActivity));
  }
  if (component.actions?.length) {
    rows += renderComponentDetailRow(t("actions"), inlineCodeValue(component.actions.join(", ")));
  }

  return rows
    ? `<div class="kv-table component-detail-table divider-kv-table">${rows}</div>`
    : "";
}

function renderComponentDetailRow(label, value) {
  return [
    `<div class="kv-row">`,
    `<div class="kv-label">${escapeHtml(label)}</div>`,
    `<div class="kv-value">${value || escapeHtml(t("unknown"))}</div>`,
    `</div>`,
  ].join("");
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

  return `${escapeHtml(t("value"))}${state.locale.startsWith("zh") ? "：" : ": "}${value}`;
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
    `<pre class="json-block">${escapeHtml(formatExportJson(report))}</pre>`,
  ].join("");
}

function renderSdkSummaryPreview(sdkSummary) {
  if (!sdkSummary) {
    return emptyList(t("noSdkMarkers"));
  }

  const combined = [];
  appendSdkSummaryEntries(combined, sdkSummary.native, t("nativeLibraries"));
  appendSdkSummaryEntries(combined, sdkSummary.components, t("components"));
  combined.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  if (combined.length === 0) {
    return emptyList(t("noSdkMarkers"));
  }

  return renderSdkRows(combined.slice(0, 8));
}

function appendSdkSummaryEntries(target, entries = [], source) {
  for (const entry of entries || []) {
    target.push({
      ...entry,
      source,
    });
  }
}

function renderSdkRows(entries) {
  if (!entries.length) {
    return emptyList(t("noSdkMarkers"));
  }

  let max = 1;
  for (const entry of entries) {
    max = Math.max(max, entry.count || 0);
  }

  const rows = entries.map((entry) => {
    const width = Math.max(4, Math.round(((entry.count || 0) / max) * 100));
    const preview = renderCodeChipList(entry.previewItems || []);
    const detail = joinTextParts([entry.source, entry.detail]);
    return [
      `<article class="sdk-row">`,
      `<div class="sdk-row-header">`,
      `<div class="sdk-title">${renderSdkIcon(entry.iconUrl, entry.label, entry.singleColorIcon)}${renderSdkRuleLabel(entry, t("unknown"))}</div>`,
      `<span class="sdk-count">${escapeHtml(String(entry.count || 0))}</span>`,
      `</div>`,
      `<div class="bar-track"><div class="bar" style="width: ${width}%"></div></div>`,
      detail ? `<div class="sdk-meta">${escapeHtml(detail)}</div>` : "",
      preview ? `<div class="sdk-preview">${preview}</div>` : "",
      `</article>`,
    ].join("");
  }).join("");

  return `<div class="sdk-stack">${rows}</div>`;
}

function renderCodeChipList(items) {
  let html = "";
  for (const item of items) {
    html += codeChip(item);
  }
  return html;
}

function joinTextParts(parts) {
  const values = [];
  for (const part of parts) {
    if (part) {
      values.push(part);
    }
  }
  return values.join(" · ");
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
  return runtime.sdkIconRendererModule.renderSdkChip(sdk, t("unknown"));
}

function renderSdkInline(sdk) {
  return runtime.sdkIconRendererModule.renderSdkInline(sdk, t("unknown"));
}

function renderSdkIcon(src, label, singleColorIcon = false) {
  return runtime.sdkIconRendererModule.renderSdkIcon(src, label, singleColorIcon);
}

function renderSdkRuleLabel(sdk, unknownLabel = "Unknown") {
  return runtime.sdkIconRendererModule.renderSdkRuleLabel(sdk, unknownLabel);
}

function renderAppIcon(info) {
  const src = sanitizeImageSrc(info.icon?.dataUri || "");
  if (src) {
    return `<span class="app-icon-frame"><img class="app-icon" src="${escapeAttr(src)}" alt="${escapeAttr(info.appName || t("appName"))}"></span>`;
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

function buildFeatureLabel(name, version) {
  return version ? `${name} ${version}` : name;
}

function buildExportReport(report) {
  return stripDataUris({
    ...report,
    apkInfo: {
      ...report.apkInfo,
    },
  });
}

function formatExportJson(report) {
  if (!report || typeof report !== "object") {
    return "{}";
  }

  const cached = exportJsonCache.get(report);
  if (cached) {
    return cached;
  }

  const formatted = JSON.stringify(buildExportReport(report), null, 2);
  exportJsonCache.set(report, formatted);
  return formatted;
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

function emptyList(message) {
  return `<p class="empty-list">${escapeHtml(message)}</p>`;
}
