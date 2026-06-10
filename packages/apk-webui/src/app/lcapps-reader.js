const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const TEXT_DECODER = new TextDecoder("utf-8");

export async function readLcappsArchive(file, options = {}) {
  const buffer = await file.arrayBuffer();
  const zipEntries = readZipEntries(buffer);
  const jsonEntry = await findAppsJsonEntry(zipEntries);
  const jsonText = TEXT_DECODER.decode(await readZipEntryBytes(jsonEntry));
  const rawPayload = parseJsonPayload(jsonText);
  const rawApps = extractAppObjects(rawPayload);
  const iconStore = await buildIconStore(zipEntries);
  const nowIso = options.nowIso || new Date().toISOString();
  const reports = rawApps.map((item, index) => {
    const report = normalizeLcappsReport(item, {
      fileName: file.name || "local.lcapps",
      fileSizeBytes: Number(file.size) || 0,
      index,
      locale: options.locale || "",
      nowIso,
    });
    applyIconToReport(report, resolveIconForReport(report, index, iconStore));
    return report;
  });

  if (reports.length === 0) {
    throw createLcappsError("lcappsEmpty");
  }

  return {
    fileName: file.name || "local.lcapps",
    fileSizeBytes: Number(file.size) || 0,
    reports,
  };
}

export function isLikelyLcappsFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".lcapps");
}

function readZipEntries(buffer) {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) {
    throw createLcappsError("lcappsInvalidZip");
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (
    entryCount === ZIP64_SENTINEL_16 ||
    centralDirectorySize === ZIP64_SENTINEL_32 ||
    centralDirectoryOffset === ZIP64_SENTINEL_32
  ) {
    throw createLcappsError("lcappsUnsupportedZip64");
  }

  const entries = [];
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;
  while (offset < endOffset && entries.length < entryCount) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw createLcappsError("lcappsInvalidZip");
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const name = decodeZipEntryName(new Uint8Array(buffer, nameStart, nameLength), flags);

    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw createLcappsError("lcappsUnsupportedZip64");
    }

    if (name && !name.endsWith("/")) {
      entries.push({
        buffer,
        name,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function decodeZipEntryName(bytes) {
  return TEXT_DECODER.decode(bytes).replaceAll("\\", "/");
}

async function findAppsJsonEntry(entries) {
  const jsonEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".json"));
  for (const entry of jsonEntries) {
    try {
      const text = TEXT_DECODER.decode(await readZipEntryBytes(entry));
      if (extractAppObjects(parseJsonPayload(text)).length === 0) {
        throw createLcappsError("lcappsEmpty");
      }
      return entry;
    } catch (error) {
      if (isLcappsErrorCode(error, "lcappsInvalidJson") || isLcappsErrorCode(error, "lcappsEmpty")) {
        continue;
      }
      throw error;
    }
  }

  throw createLcappsError("lcappsMissingJson");
}

function parseJsonPayload(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw createLcappsError("lcappsInvalidJson", { cause: error });
  }
}

function extractAppObjects(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object");
  }

  if (!payload || typeof payload !== "object") {
    throw createLcappsError("lcappsInvalidJson");
  }

  if (payload.apkInfo || payload.packageName) {
    return [payload];
  }

  for (const key of ["apps", "reports", "items", "data", "applications"]) {
    if (Array.isArray(payload[key])) {
      return payload[key].filter((item) => item && typeof item === "object");
    }
  }

  throw createLcappsError("lcappsEmpty");
}

async function buildIconStore(entries) {
  const icons = [];
  const byPath = new Map();
  const byBaseName = new Map();
  const byStem = new Map();

  for (const entry of entries) {
    const mimeType = getImageMimeType(entry.name);
    if (!mimeType) {
      continue;
    }

    const bytes = await readZipEntryBytes(entry);
    const icon = {
      name: entry.name,
      baseName: getBaseName(entry.name),
      stem: getStem(entry.name),
      dataUri: await bytesToDataUri(bytes, mimeType),
      mimeType,
    };
    icons.push(icon);
    setFirst(byPath, normalizePathKey(icon.name), icon);
    setFirst(byBaseName, normalizePathKey(icon.baseName), icon);
    setFirst(byStem, normalizePathKey(icon.stem), icon);
  }

  return {
    icons,
    byPath,
    byBaseName,
    byStem,
  };
}

async function readZipEntryBytes(entry) {
  const compressedBytes = readCompressedZipEntryBytes(entry);
  if (entry.compressionMethod === 0) {
    return compressedBytes;
  }

  if (entry.compressionMethod === 8) {
    return inflateZipDeflate(compressedBytes);
  }

  throw createLcappsError("lcappsUnsupportedCompression");
}

function readCompressedZipEntryBytes(entry) {
  const view = new DataView(entry.buffer);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw createLcappsError("lcappsInvalidZip");
  }

  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > entry.buffer.byteLength || dataEnd < dataStart) {
    throw createLcappsError("lcappsInvalidZip");
  }

  return new Uint8Array(entry.buffer, dataStart, entry.compressedSize);
}

async function inflateZipDeflate(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw createLcappsError("unsupportedDecompression");
  }

  let lastError = null;
  for (const format of ["deflate-raw", "deflate"]) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }

  throw createLcappsError("lcappsUnsupportedCompression", { cause: lastError });
}

function normalizeLcappsReport(item, context) {
  const sourceReport = item?.apkInfo && typeof item.apkInfo === "object"
    ? item
    : { apkInfo: item };
  const terminalSystem = normalizeTerminalSystem(
    sourceReport.terminalSystem ||
    sourceReport.analysisProfile?.runtime?.system ||
    {},
  );
  const report = {
    ...sourceReport,
    locale: stringValue(sourceReport.locale || context.locale || "en"),
    terminalSystem,
    analysisProfile: normalizeAnalysisProfile(sourceReport.analysisProfile, terminalSystem),
    durationMs: finiteNumber(sourceReport.durationMs, 0),
    fileName: stringValue(sourceReport.fileName || context.fileName || "local.lcapps"),
    fileSizeBytes: finiteNumber(sourceReport.fileSizeBytes, context.fileSizeBytes || 0),
    analyzedAt: stringValue(sourceReport.analyzedAt || context.nowIso),
    apkInfo: normalizeApkInfo(sourceReport.apkInfo || {}),
  };

  if (!report.apkInfo.packageName) {
    report.apkInfo.packageName = `lcapps.item.${context.index + 1}`;
  }
  if (!report.apkInfo.appName) {
    report.apkInfo.appName = report.apkInfo.packageName;
  }

  return report;
}

function normalizeTerminalSystem(system) {
  return {
    name: stringValue(system?.name),
    version: stringValue(system?.version),
    source: stringValue(system?.source || "lcapps"),
  };
}

function normalizeAnalysisProfile(profile, terminalSystem) {
  return {
    ...profile,
    id: stringValue(profile?.id || "lcapps-import"),
    capabilities: Array.isArray(profile?.capabilities) ? profile.capabilities : ["lcapps-import"],
    ruleCount: finiteNumber(profile?.ruleCount, 0),
    iconCount: finiteNumber(profile?.iconCount, 0),
    uniqueSdkCount: finiteNumber(profile?.uniqueSdkCount, 0),
    sdkMarkerCount: finiteNumber(profile?.sdkMarkerCount, 0),
    nativeSdkMarkerCount: finiteNumber(profile?.nativeSdkMarkerCount, 0),
    componentSdkMarkerCount: finiteNumber(profile?.componentSdkMarkerCount, 0),
    runtime: {
      ...(profile?.runtime || {}),
      worker: Boolean(profile?.runtime?.worker),
      decompressionStream: Boolean(profile?.runtime?.decompressionStream),
      system: terminalSystem,
    },
  };
}

function normalizeApkInfo(info) {
  const icon = normalizeIcon(info.icon);
  return {
    ...info,
    appName: stringValue(info.appName || info.label || info.name),
    packageName: stringValue(info.packageName || info.package),
    versionName: stringValue(info.versionName),
    versionCode: stringValue(info.versionCode),
    minSdk: stringValue(info.minSdk),
    targetSdk: stringValue(info.targetSdk),
    compileSdk: stringValue(info.compileSdk),
    icon,
    permissions: arrayValue(info.permissions),
    nativeLibraries: arrayValue(info.nativeLibraries),
    components: normalizeComponents(info.components),
    metaData: normalizeMetaData(info.metaData),
    buildFeatures: normalizeBuildFeatures(info.buildFeatures),
    signatures: normalizeSignatures(info.signatures),
    sdkSummary: normalizeSdkSummary(info.sdkSummary),
  };
}

function normalizeIcon(icon) {
  if (typeof icon === "string") {
    return {
      dataUri: isImageDataUri(icon) ? icon : "",
      path: isImageDataUri(icon) ? "" : icon,
    };
  }

  if (!icon || typeof icon !== "object") {
    return null;
  }

  return {
    ...icon,
    dataUri: isImageDataUri(icon.dataUri) ? icon.dataUri : "",
    path: stringValue(icon.path || icon.fileName || icon.name),
    mimeType: stringValue(icon.mimeType),
  };
}

function normalizeComponents(components) {
  return {
    activities: arrayValue(components?.activities),
    services: arrayValue(components?.services),
    receivers: arrayValue(components?.receivers),
    providers: arrayValue(components?.providers),
  };
}

function normalizeMetaData(metaData) {
  return {
    ...(metaData && typeof metaData === "object" ? metaData : {}),
    application: arrayValue(metaData?.application),
    components: arrayValue(metaData?.components),
  };
}

function normalizeBuildFeatures(buildFeatures) {
  return {
    ...(buildFeatures && typeof buildFeatures === "object" ? buildFeatures : {}),
    kotlinDetected: Boolean(buildFeatures?.kotlinDetected),
    kotlinVersion: nullableString(buildFeatures?.kotlinVersion),
    composeDetected: Boolean(buildFeatures?.composeDetected),
    composeVersion: nullableString(buildFeatures?.composeVersion),
    gradleVersion: nullableString(buildFeatures?.gradleVersion),
    agpVersion: nullableString(buildFeatures?.agpVersion),
    appMetadataVersion: nullableString(buildFeatures?.appMetadataVersion),
  };
}

function normalizeSignatures(signatures) {
  return {
    ...(signatures && typeof signatures === "object" ? signatures : {}),
    certificates: arrayValue(signatures?.certificates),
    signers: arrayValue(signatures?.signers),
    schemes: arrayValue(signatures?.schemes),
  };
}

function normalizeSdkSummary(sdkSummary) {
  if (!sdkSummary || typeof sdkSummary !== "object") {
    return {
      native: [],
      components: [],
    };
  }

  return {
    ...sdkSummary,
    native: arrayValue(sdkSummary.native),
    components: arrayValue(sdkSummary.components),
  };
}

function resolveIconForReport(report, index, iconStore) {
  const info = report.apkInfo || {};
  if (isImageDataUri(info.icon?.dataUri)) {
    return null;
  }

  const candidates = [
    info.icon?.path,
    info.icon?.fileName,
    info.iconPath,
    info.iconFile,
    info.iconFileName,
    report.iconPath,
    report.iconFile,
    report.iconFileName,
    info.packageName,
    info.packageName ? `${info.packageName}.png` : "",
    info.packageName ? `icons/${info.packageName}.png` : "",
    report.fileName,
    `${index}.png`,
    `${index + 1}.png`,
  ];

  for (const candidate of candidates) {
    const icon = findIconByCandidate(candidate, iconStore);
    if (icon) {
      return icon;
    }
  }

  if (iconStore.icons.length === 1) {
    return iconStore.icons[0];
  }

  if (iconStore.icons.length === index + 1 || iconStore.icons.length > index) {
    return iconStore.icons[index] || null;
  }

  return null;
}

function findIconByCandidate(candidate, iconStore) {
  const key = normalizePathKey(candidate);
  if (!key) {
    return null;
  }

  const baseName = normalizePathKey(getBaseName(key));
  const stem = normalizePathKey(getStem(key));
  return (
    iconStore.byPath.get(key) ||
    iconStore.byBaseName.get(baseName) ||
    iconStore.byStem.get(stem) ||
    null
  );
}

function applyIconToReport(report, icon) {
  if (!icon || !isImageDataUri(icon.dataUri)) {
    return;
  }

  report.apkInfo.icon = {
    ...(report.apkInfo.icon || {}),
    dataUri: icon.dataUri,
    mimeType: icon.mimeType,
    path: report.apkInfo.icon?.path || icon.name,
  };
}

function getImageMimeType(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "";
}

function bytesToDataUri(bytes, mimeType) {
  if (typeof FileReader !== "function" && typeof Buffer !== "undefined") {
    return Promise.resolve(`data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("Failed to read image")), { once: true });
    reader.readAsDataURL(new Blob([bytes], { type: mimeType }));
  });
}

function getBaseName(path) {
  return String(path || "").split(/[\\/]/u).pop() || "";
}

function getStem(path) {
  return getBaseName(path).replace(/\.[^.]+$/u, "");
}

function normalizePathKey(value) {
  return String(value || "").trim().replaceAll("\\", "/").toLowerCase();
}

function setFirst(map, key, value) {
  if (key && !map.has(key)) {
    map.set(key, value);
  }
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return value == null ? "" : String(value);
}

function nullableString(value) {
  return value == null || value === "" ? null : String(value);
}

function finiteNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function isImageDataUri(value) {
  return /^data:image\//iu.test(String(value || ""));
}

function createLcappsError(code, options = {}) {
  const error = new Error(code, options);
  error.code = code;
  return error;
}

function isLcappsErrorCode(error, code) {
  return error?.code === code || error?.message === code;
}
