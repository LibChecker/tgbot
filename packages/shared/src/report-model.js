/** @typedef {import("./contracts.js").ApkComponentGroups} ApkComponentGroups */
/** @typedef {import("./contracts.js").ApkInfo} ApkInfo */

export const COMPONENT_SECTIONS = ["activities", "services", "receivers", "providers"];
export const NATIVE_PAGE_SIZE_16_KB = 0x4000;

/** @param {Partial<ApkInfo>} info */
export function getStats(info = {}) {
  return {
    permissions: info.permissions?.length || 0,
    nativeLibraries: info.nativeLibraries?.length || 0,
    components: countComponents(info.components),
    signatures: info.signatures?.certificates?.length || 0,
    metaData: info.metaData?.application?.length || 0,
  };
}

/** @param {Partial<ApkComponentGroups>} [components] */
export function countComponents(components = {}) {
  return COMPONENT_SECTIONS.reduce((sum, key) => sum + (components[key]?.length || 0), 0);
}

/**
 * @template T
 * @param {Iterable<T>} items
 * @param {(item: T) => string} getKey
 * @returns {Map<string, T[]>}
 */
export function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    const values = groups.get(key) || [];
    values.push(item);
    groups.set(key, values);
  }
  return groups;
}

export function buildApkReportViewModel(report, options = {}) {
  const info = report?.apkInfo || {};
  const labels = options.labels || {};
  const unknown = labels.unknown || options.unknownLabel || "Unknown";
  const formatBytes = options.formatBytes || defaultFormatBytes;
  const formatDate = options.formatDate || ((value) => String(value || unknown));
  const formatDuration = options.formatDuration || ((durationMs) => (
    Number.isFinite(durationMs) ? `${(durationMs / 1000).toFixed(2)}s` : ""
  ));
  const stats = report?.originalStats || getStats(info);
  const fileSize = report?.fileSizeText || (
    Number.isFinite(report?.fileSizeBytes) ? formatBytes(report.fileSizeBytes) : ""
  );
  const duration = Number.isFinite(report?.durationMs) ? formatDuration(report.durationMs) : "";
  const terminalSystem = formatTerminalSystem(report, unknown);

  return {
    summary: {
      stats,
      metrics: [
        metric("permissions", labels.permissions || "Permissions", stats.permissions),
        metric("nativeLibraries", labels.nativeLibraries || "Native Libraries", stats.nativeLibraries),
        metric("components", labels.components || "Components", stats.components),
        metric("signatures", labels.signatures || "Signatures", stats.signatures),
        metric("metaData", labels.metaData || "Meta-Data", stats.metaData),
      ],
      rows: compactRows([
        row("appName", labels.appName || "App Name", info.appName),
        row("packageName", labels.packageName || "Package Name", info.packageName),
        row("versionName", labels.versionName || "Version Name", info.versionName),
        row("versionCode", labels.versionCode || "Version Code", info.versionCode),
        row("targetSdk", labels.targetSdk || "Target SDK", info.targetSdk),
        row("minSdk", labels.minSdk || "Min SDK", info.minSdk),
        row("compileSdk", labels.compileSdk || "Compile SDK", info.compileSdk),
        row("fileName", labels.fileName || "File Name", report?.fileName),
        row("fileSize", labels.fileSize || "File Size", fileSize),
        row("source", labels.source || "Source", report?.sourceLabel),
        row("analyzedAt", labels.analyzedAt || "Analyzed At", report?.analyzedAt ? formatDate(report.analyzedAt) : ""),
        row("duration", labels.duration || "Duration", duration),
        options.includeTerminalSystem === false
          ? null
          : row("terminalSystem", labels.terminalSystem || "Terminal System", terminalSystem || unknown),
      ]),
      features: getBuildFeatureItems(info.buildFeatures, options.featureLabels || labels),
      sdkPreview: getSdkSummaryPreviewEntries(info.sdkSummary, {
        native: labels.nativeLibraries || "Native Libraries",
        components: labels.components || "Components",
      }),
    },
    sdk: {
      native: info.sdkSummary?.native || [],
      components: info.sdkSummary?.components || [],
    },
    native: {
      groups: getNativeLibraryGroups(info.nativeLibraries || [], unknown),
    },
    components: {
      total: countComponents(info.components),
      groups: getComponentGroups(info.components, (sectionName) => labels[sectionName] || sectionName),
    },
    permissions: {
      items: getSortedPermissions(info.permissions || []),
    },
    signatures: {
      schemes: info.signatures?.schemes || [],
      certificates: (info.signatures?.certificates || []).map((certificate, index) => ({
        index,
        title: formatTemplate(labels.signatureCertificate || "Signature Certificate {index}", { index: index + 1 }),
        rows: getSignatureCertificateRows(certificate, labels, {
          formatBytes,
          formatDate: options.formatSignatureDate || formatDate,
          unknown,
        }),
      })),
    },
    metaData: {
      application: info.metaData?.application || [],
    },
  };
}

function metric(key, label, value) {
  return { key, label, value };
}

function row(key, label, value) {
  return { key, label, value };
}

function compactRows(rows) {
  return rows.filter((entry) => entry && hasReportValue(entry.value));
}

export function getBuildFeatureItems(buildFeatures = {}, labels = {}) {
  const detected = labels.detected || labels.featureDetected || "Detected";
  const items = [];

  if (buildFeatures.kotlinDetected) {
    items.push(featureItem("kotlin", labels.kotlin || "Kotlin", buildFeatures.kotlinVersion, detected));
  }
  if (buildFeatures.composeDetected) {
    items.push(featureItem("compose", labels.compose || "Compose", buildFeatures.composeVersion, detected));
  }
  if (buildFeatures.gradleVersion) {
    items.push(featureItem("gradle", labels.gradle || "Gradle", buildFeatures.gradleVersion, detected));
  }
  if (buildFeatures.agpVersion) {
    items.push(featureItem("agp", labels.agp || "AGP", buildFeatures.agpVersion, detected));
  }
  if (buildFeatures.appMetadataVersion) {
    items.push(featureItem(
      "appMetadataVersion",
      labels.appMetadataVersion || "App Metadata",
      buildFeatures.appMetadataVersion,
      detected,
    ));
  }

  return items;
}

function featureItem(key, name, version, detected) {
  return {
    key,
    name,
    value: version || detected,
    text: buildFeatureLabel(name, version),
  };
}

export function buildFeatureLabel(name, version) {
  return version ? `${name} ${version}` : name;
}

export function getSdkSummaryPreviewEntries(sdkSummary, sourceLabels = {}, limit = 8) {
  const combined = [];
  appendSdkSummaryEntries(combined, sdkSummary?.native, sourceLabels.native || "Native Libraries");
  appendSdkSummaryEntries(combined, sdkSummary?.components, sourceLabels.components || "Components");
  combined.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  return combined.slice(0, limit);
}

export function appendSdkSummaryEntries(target, entries = [], source) {
  for (const entry of entries || []) {
    target.push({
      ...entry,
      source,
    });
  }
}

export function getNativeLibraryGroups(libraries = [], unknownLabel = "Unknown") {
  return [...groupBy(libraries, (library) => library.abi || unknownLabel).entries()]
    .map(([abi, items]) => ({ abi, items }));
}

export function getNativeLibraryLabels(library) {
  const labels = [];
  if (isNativeLibraryElf16KbAligned(library)) {
    labels.push({ text: "16 KB", tone: "ok" });
  }

  const zipAlignment = Number(library.zipAlignment) || 0;
  if (zipAlignment > 0 && zipAlignment < NATIVE_PAGE_SIZE_16_KB) {
    labels.push({ text: formatNativeZipAlignmentLabel(zipAlignment), tone: "warning" });
  }

  return labels;
}

export function isNativeLibraryElf16KbAligned(library) {
  if (library?.elf16kbAligned === true) {
    return true;
  }

  const pageSize = Number(library?.elfPageSize) || 0;
  return pageSize > 0 && pageSize % NATIVE_PAGE_SIZE_16_KB === 0;
}

export function formatNativeZipAlignmentLabel(zipAlignment) {
  if (zipAlignment >= 1024 && zipAlignment % 1024 === 0) {
    return `${zipAlignment / 1024}KB ZIPALIGN`;
  }
  return `${zipAlignment}B ZIPALIGN`;
}

export function getComponentGroups(components = {}, getLabel = (sectionName) => sectionName) {
  return COMPONENT_SECTIONS.map((sectionName) => ({
    key: sectionName,
    label: getLabel(sectionName),
    items: components?.[sectionName] || [],
  }));
}

export function getSortedPermissions(permissions = []) {
  return [...permissions]
    .sort((left, right) => String(left || "").localeCompare(String(right || ""), "en", { sensitivity: "base" }));
}

export function getSignatureCertificateRows(certificate = {}, labels = {}, options = {}) {
  const publicKey = certificate.publicKey || {};
  const signatureAlgorithm = certificate.signatureAlgorithm || {};
  const fingerprints = certificate.fingerprints || {};
  const validity = certificate.validity || {};
  const unknown = labels.unknown || options.unknown || "Unknown";
  const formatBytes = options.formatBytes || defaultFormatBytes;
  const formatDate = options.formatDate || ((value) => value || unknown);

  return compactRows([
    field("schemes", labels.signatureSchemes || "Signing Schemes", certificate.schemes || [], "list"),
    field("version", labels.signatureVersion || "Version", certificate.version || unknown),
    field("serialNumber", labels.signatureSerialNumber || "Serial Number", formatSignatureNumber(certificate.serialNumber, unknown) || unknown, "code"),
    field("issuer", labels.signatureIssuer || "Issuer", certificate.issuer, "code"),
    field("subject", labels.signatureSubject || "Subject", certificate.subject, "code"),
    field("validFrom", labels.signatureValidFrom || "Valid From", formatDate(validity.notBefore)),
    field("validTo", labels.signatureValidTo || "Valid To", formatDate(validity.notAfter)),
    field("publicKeyFormat", labels.signaturePublicKeyFormat || "Public Key Format", publicKey.format || unknown),
    field("publicKeyAlgorithm", labels.signaturePublicKeyAlgorithm || "Public Key Algorithm", publicKey.algorithm || unknown),
    field("publicKeyExponent", labels.signaturePublicKeyExponent || "Public Key Exponent", formatSignatureNumber(publicKey.exponent, unknown), "code"),
    field("publicKeyModulusSize", labels.signaturePublicKeyModulusSize || "Modulus Size", publicKey.modulusSizeBits ? `${publicKey.modulusSizeBits} bits` : ""),
    field("publicKeyModulus", labels.signaturePublicKeyModulus || "Modulus", formatSignatureHexBlock(publicKey.modulusHex), "blockCode"),
    field("publicKeyY", labels.signaturePublicKeyY || "Public Key Y", publicKey.y, "code"),
    field("publicKeyType", labels.signaturePublicKeyType || "Public Key Type", publicKey.type),
    field("algorithmName", labels.signatureAlgorithmName || "Signature Algorithm", signatureAlgorithm.name || unknown),
    field("algorithmOid", labels.signatureAlgorithmOid || "Signature Algorithm OID", signatureAlgorithm.oid, "code"),
    field("md5", labels.signatureMd5 || "MD5", fingerprints.md5, "code"),
    field("sha1", labels.signatureSha1 || "SHA1", fingerprints.sha1, "code"),
    field("sha256", labels.signatureSha256 || "SHA256", fingerprints.sha256, "code"),
    field("charString", labels.signatureCharString || "CharString", certificate.charString, "code"),
    field("sourceEntries", labels.signatureSourceEntry || "Source Entry", certificate.sourceEntries || [], "list"),
    field("derLength", labels.signatureDerLength || "Certificate Size", certificate.derLength ? formatBytes(certificate.derLength) : ""),
  ]);
}

function field(key, label, value, kind = "text") {
  return { key, label, value, kind };
}

function formatSignatureNumber(value, unknown) {
  if (!value) {
    return "";
  }

  return `${value.decimal || unknown} (${value.hex || unknown})`;
}

export function formatSignatureHexBlock(value) {
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

export function formatTerminalSystem(report, unknownLabel = "Unknown") {
  const system = report?.terminalSystem || report?.analysisProfile?.runtime?.system || {};
  const name = String(system.name || "").trim();
  const version = String(system.version || "").trim();

  if (!name && !version) {
    return unknownLabel;
  }

  return [name, version].filter(Boolean).join(" ");
}

function hasReportValue(value) {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return String(value).length > 0;
}

function defaultFormatBytes(bytes) {
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

function formatTemplate(template, variables) {
  return String(template).replace(/\{(\w+)\}/gu, (_, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}
