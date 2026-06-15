import { readApkInfoFromZipSource } from "../../shared/src/apk.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const ZIP64_NO_ENTRY = 0xffffffff;
const EOCD_PROBE_BYTES = 65_536;
const CENTRAL_DIRECTORY_FIXED_HEADER_SIZE = 46;
const LOCAL_FILE_HEADER_FIXED_SIZE = 30;
const DEFAULT_TAIL_PREFETCH_BYTES = EOCD_PROBE_BYTES;
const DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_COMPRESSED_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_RESOURCE_BYTES = 12 * 1024 * 1024;
const METADATA_PROBE_BYTES = 1024;
const LOCAL_HEADER_EXTRA_SLOP_BYTES = 512;
const SMALL_ENTRY_COALESCE_MAX_BYTES = 128 * 1024;
const SMALL_ENTRY_LOOKAHEAD_BYTES = 192 * 1024;
const SMALL_ENTRY_COALESCE_MIN_OFFSET = 1024 * 1024;
const V1_SIGNATURE_ENTRY_PATTERN = /^META-INF\/[^/]+\.(?:RSA|DSA|EC)$/iu;
const METADATA_PREFETCH_ENTRY_NAMES = new Set([
  "AndroidManifest.xml",
  "META-INF/androidx.compose.runtime_runtime.version",
  "META-INF/androidx.compose.ui_ui.version",
  "META-INF/androidx.compose.ui_ui-tooling-preview.version",
  "META-INF/androidx.compose.foundation_foundation.version",
  "META-INF/androidx.compose.animation_animation.version",
  "META-INF/com/android/build/gradle/app-metadata.properties",
  "BUNDLE-METADATA/com.android.tools.build.gradle/app-metadata.properties",
  "kotlin-tooling-metadata.json",
]);
const APK_MANIFEST_ENTRY_NAME = "AndroidManifest.xml";
const APK_URL_ANALYSIS_ERROR_NAME = "ApkUrlAnalysisError";

const utf8Decoder = new TextDecoder();

export async function readApkInfoFromUrl(rawUrl, options = {}) {
  const stats = {
    mode: "range",
    rangeRequestCount: 0,
    downloadedBytes: 0,
    rangeCacheHitCount: 0,
  };
  const diagnostics = {
    analysis_stage: "url_parse",
    link_preview_mode: stats.mode,
  };

  try {
    notifyUrlProgress(options, stats, diagnostics, "url_parse", 0.06);
    const apkUrl = parseHttpUrl(rawUrl);
    diagnostics.analysis_stage = "remote_metadata";
    notifyUrlProgress(options, stats, diagnostics, "remote_metadata", 0.1);
    const metadata = await fetchRemoteMetadata(apkUrl, stats);
    diagnostics.content_length_bytes = metadata.contentLength || 0;
    diagnostics.content_type = metadata.contentType || "";
    diagnostics.supports_range = Boolean(metadata.supportsRange);
    notifyUrlProgress(options, stats, diagnostics, "remote_metadata", 0.18);

    if (!metadata.contentLength || metadata.contentLength <= 0) {
      throw new Error("The remote link did not return Content-Length, so the APK ZIP central directory cannot be located");
    }

    diagnostics.analysis_stage = "zip_tail";
    notifyUrlProgress(options, stats, diagnostics, "zip_tail", 0.24);
    const tailPrefetchBytes = Math.max(
      EOCD_PROBE_BYTES,
      options.tailPrefetchBytes ?? DEFAULT_TAIL_PREFETCH_BYTES,
    );
    const tailStart = Math.max(0, metadata.contentLength - tailPrefetchBytes);
    const tailBytes = await downloadRange(apkUrl, tailStart, metadata.contentLength - tailStart, stats);
    notifyUrlProgress(options, stats, diagnostics, "zip_tail", 0.36);
    const eocdOffsetInTail = findEndOfCentralDirectory(tailBytes);
    const eocd = parseEocd(tailBytes, eocdOffsetInTail);
    const maxCentralDirectoryBytes = options.maxCentralDirectoryBytes ?? DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES;

    if (eocd.centralDirectorySize > maxCentralDirectoryBytes) {
      throw new Error(`The remote APK central directory is too large; the current preview limit is ${formatBytes(maxCentralDirectoryBytes)}`);
    }

    diagnostics.analysis_stage = "central_directory";
    notifyUrlProgress(options, stats, diagnostics, "central_directory", 0.46);
    const centralDirectoryBytes = await readBufferedOrRemoteRange(
      apkUrl,
      eocd.centralDirectoryOffset,
      eocd.centralDirectorySize,
      {
        bufferOffset: tailStart,
        bufferBytes: tailBytes,
        stats,
      },
    );
    const zipEntries = parseCentralDirectory(centralDirectoryBytes);
    Object.assign(diagnostics, describeRemoteZipEntries(zipEntries));
    notifyUrlProgress(options, stats, diagnostics, "central_directory", 0.58);
    const maxEntryCompressedBytes = options.maxEntryCompressedBytes ?? DEFAULT_MAX_ENTRY_COMPRESSED_BYTES;
    const rangeCache = createRangeCache([
      metadata.probeRange,
      {
        offset: tailStart,
        bytes: tailBytes,
      },
    ]);
    prefetchLikelyMetadataRange(apkUrl, zipEntries, metadata.contentLength, stats, rangeCache);

    if (!zipEntries.has(APK_MANIFEST_ENTRY_NAME)) {
      throw createMissingRemoteManifestError(diagnostics);
    }

    diagnostics.analysis_stage = "apk_metadata";
    notifyUrlProgress(options, stats, diagnostics, "apk_metadata", 0.68);
    const source = {
      zipEntries,
      extractEntry: (entry) =>
        downloadRemoteZipEntry(apkUrl, entry, stats, {
          contentLength: metadata.contentLength,
          maxEntryCompressedBytes,
          rangeCache,
        }),
    };

    const apkInfo = await readApkInfoFromZipSource(source, {
      scanDex: false,
      maxResourceBytes: options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES,
    });
    notifyUrlProgress(options, stats, diagnostics, "apk_metadata", 0.82);

    return {
      apkInfo,
      url: apkUrl.toString(),
      fileName: inferFileNameFromUrl(apkUrl),
      fileSize: metadata.contentLength,
      metadata: createPublicMetadata(metadata),
      stats,
      diagnostics: compactDiagnosticFields(diagnostics),
    };
  } catch (error) {
    throw annotateUrlAnalysisError(error, diagnostics, stats);
  }
}

function notifyUrlProgress(options, stats, diagnostics, stage, progress) {
  if (typeof options.onProgress !== "function") {
    return;
  }

  try {
    options.onProgress(compactDiagnosticFields({
      stage,
      progress,
      analysis_stage: diagnostics.analysis_stage,
      content_length_bytes: diagnostics.content_length_bytes || 0,
      downloaded_bytes: stats.downloadedBytes || 0,
      range_request_count: stats.rangeRequestCount || 0,
      range_cache_hit_count: stats.rangeCacheHitCount || 0,
    }));
  } catch {
    // Progress reporting must not affect APK parsing.
  }
}

export function inferFileNameFromUrl(rawUrl) {
  const url = rawUrl instanceof URL ? rawUrl : parseHttpUrl(rawUrl);
  const pathName = url.pathname.split("/").filter(Boolean).at(-1) || "";

  try {
    const decoded = decodeURIComponent(pathName);
    return decoded || `${url.hostname}.apk`;
  } catch {
    return pathName || `${url.hostname}.apk`;
  }
}

async function fetchRemoteMetadata(url, stats) {
  const probeResult = await fetchRangeProbeMetadata(url, stats);
  if (probeResult?.contentLength > 0) {
    return probeResult;
  }

  const headResult = await fetchHeadMetadata(url);
  if (headResult?.contentLength > 0 && headResult.supportsRange) {
    return headResult;
  }

  throw new Error("The remote link does not support HTTP Range, so it cannot be parsed without a full download");
}

async function fetchHeadMetadata(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: buildRemoteHeaders(),
    });

    if (!response.ok) {
      return null;
    }

    return {
      contentLength: parseContentLength(response.headers.get("content-length")),
      contentType: response.headers.get("content-type") || null,
      supportsRange: acceptsRange(response.headers),
    };
  } catch {
    return null;
  }
}

async function fetchRangeProbeMetadata(url, stats) {
  const response = await fetch(url, {
    headers: {
      ...buildRemoteHeaders(),
      range: `bytes=0-${METADATA_PROBE_BYTES - 1}`,
    },
  });

  if (response.status !== 206) {
    await cancelResponseBody(response);
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  stats.rangeRequestCount += 1;
  stats.downloadedBytes += bytes.byteLength;

  return {
    contentLength: parseContentRangeTotal(response.headers.get("content-range")),
    contentType: response.headers.get("content-type") || null,
    supportsRange: true,
    probeRange: {
      offset: 0,
      bytes,
    },
  };
}

function createPublicMetadata(metadata) {
  return {
    contentLength: metadata.contentLength,
    contentType: metadata.contentType,
    supportsRange: metadata.supportsRange,
  };
}

function describeRemoteZipEntries(zipEntries) {
  const apkEntries = collectContainedApkEntries(zipEntries);
  const selectedApk = apkEntries[0] || null;

  return compactDiagnosticFields({
    analysis_stage: "central_directory",
    remote_package_type: zipEntries.has(APK_MANIFEST_ENTRY_NAME) ? "apk" : apkEntries.length > 0 ? "package-container" : "zip",
    top_level_zip_entry_count: zipEntries.size,
    has_top_level_manifest: zipEntries.has(APK_MANIFEST_ENTRY_NAME),
    apk_entry_count: apkEntries.length,
    apk_entry_names_preview: apkEntries
      .slice(0, 6)
      .map((entry) => getContainedApkFileName(entry.path))
      .join(","),
    selected_apk_entry: selectedApk ? getContainedApkFileName(selectedApk.path) : "",
    selected_apk_compression: selectedApk ? formatZipCompressionMethod(selectedApk.entry.compressionMethod) : "",
    selected_apk_compressed_size: selectedApk?.entry.compressedSize || 0,
    selected_apk_uncompressed_size: selectedApk?.entry.uncompressedSize || 0,
  });
}

function collectContainedApkEntries(zipEntries) {
  const entries = [];
  for (const [path, entry] of zipEntries.entries()) {
    if (!isContainedApkPath(path)) {
      continue;
    }

    entries.push({
      path,
      entry,
      score: scoreContainedApkPath(path),
    });
  }

  return entries.sort((left, right) => (
    left.score - right.score ||
    left.path.localeCompare(right.path)
  ));
}

function isContainedApkPath(path) {
  const normalized = String(path || "").toLowerCase().replaceAll("\\", "/");
  return normalized.endsWith(".apk") && !normalized.startsWith("__macosx/");
}

function scoreContainedApkPath(path) {
  const fileName = getContainedApkFileName(path);

  if (fileName === "base.apk") {
    return 0;
  }

  if (fileName === "base-master.apk") {
    return 1;
  }

  if (/^base[-_.].+\.apk$/u.test(fileName)) {
    return 2;
  }

  if (fileName === "standalone.apk" || fileName.endsWith("-standalone.apk")) {
    return 3;
  }

  return isLikelySplitApkFileName(fileName) ? 5 : 4;
}

function getContainedApkFileName(path) {
  const normalized = String(path || "").toLowerCase();
  let end = normalized.length - 1;
  while (end >= 0 && isPathSeparator(normalized.charCodeAt(end))) {
    end -= 1;
  }
  if (end < 0) {
    return normalized;
  }

  let start = end;
  while (start >= 0 && !isPathSeparator(normalized.charCodeAt(start))) {
    start -= 1;
  }

  return normalized.slice(start + 1, end + 1) || normalized;
}

function isPathSeparator(charCode) {
  return charCode === 47 || charCode === 92;
}

function isLikelySplitApkFileName(fileName) {
  const stem = fileName.replace(/\.apk$/u, "");

  return (
    /(?:^|[-_.])(?:split|config|dpi|lang|armeabi|arm64|x86|mips|ldpi|mdpi|tvdpi|hdpi|xhdpi|xxhdpi|xxxhdpi|nodpi|anydpi)(?:[-_.]|$)/u.test(fileName) ||
    /^(?:armeabi|armeabi-v7a|arm64-v8a|x86|x86_64|mips|mips64)$/u.test(stem) ||
    /^(?:ldpi|mdpi|tvdpi|hdpi|xhdpi|xxhdpi|xxxhdpi|nodpi|anydpi)$/u.test(stem) ||
    /^[a-z]{2}(?:[-_][a-z0-9]{2,8})?$/u.test(stem)
  );
}

function formatZipCompressionMethod(method) {
  if (method === ZIP_COMPRESSION_STORE) {
    return "store";
  }

  if (method === ZIP_COMPRESSION_DEFLATE) {
    return "deflate";
  }

  return `method_${method}`;
}

function createMissingRemoteManifestError(diagnostics) {
  if (diagnostics.apk_entry_count > 0) {
    const selectedEntry = diagnostics.selected_apk_entry || "APK";
    const compression = diagnostics.selected_apk_compression || "unknown";
    const message =
      compression === "deflate"
        ? `The remote link is an APKM/APKS/XAPK container, and nested ${selectedEntry} is deflate-compressed. URL preview cannot read its AndroidManifest.xml without a full download; upload the file or provide a direct APK link.`
        : `The remote link is an APKM/APKS/XAPK container and has no top-level AndroidManifest.xml. URL preview has not parsed nested ${selectedEntry}.`;

    return createUrlAnalysisError(message, "remote_package_container_nested_manifest_unavailable", {
      ...diagnostics,
      analysis_stage: "container_detection",
    });
  }

  return createUrlAnalysisError("The APK is missing AndroidManifest.xml", "manifest_missing", {
    ...diagnostics,
    analysis_stage: "manifest_lookup",
  });
}

function createUrlAnalysisError(message, code, diagnostics = {}) {
  const error = new Error(message);
  error.name = APK_URL_ANALYSIS_ERROR_NAME;
  error.code = code;
  error.diagnostics = compactDiagnosticFields(diagnostics);
  return error;
}

function annotateUrlAnalysisError(error, diagnostics, stats) {
  const output = error instanceof Error ? error : new Error("Failed to parse the remote APK link");
  if (!output.name || output.name === "Error") {
    output.name = APK_URL_ANALYSIS_ERROR_NAME;
  }
  if (!output.code) {
    output.code = inferUrlAnalysisErrorCode(output);
  }

  output.diagnostics = compactDiagnosticFields({
    ...diagnostics,
    ...output.diagnostics,
    error_code: output.code,
    link_preview_mode: stats.mode,
    range_request_count: stats.rangeRequestCount,
    downloaded_bytes: stats.downloadedBytes,
    range_cache_hit_count: stats.rangeCacheHitCount,
  });

  return output;
}

function inferUrlAnalysisErrorCode(error) {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("HTTP Range")) {
    return "remote_range_unsupported";
  }

  if (message.includes("central directory")) {
    return "central_directory_error";
  }

  if (message.includes("AndroidManifest.xml")) {
    return "manifest_error";
  }

  if (error instanceof TypeError) {
    return "remote_fetch_failed";
  }

  return "url_analysis_failed";
}

function compactDiagnosticFields(fields) {
  const compacted = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value == null || value === "") {
      continue;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      compacted[key] = value;
    }
  }
  return compacted;
}

async function downloadRemoteZipEntry(url, entry, stats, options) {
  if ((entry.flags & 0x0001) !== 0) {
    throw new Error("Encrypted ZIP entries are not supported");
  }

  if (entry.compressedSize > options.maxEntryCompressedBytes) {
    throw new Error(`Remote APK entry ${entry.name || ""} is too large; the current preview limit is ${formatBytes(options.maxEntryCompressedBytes)}`);
  }

  const entryRange = await downloadEntryInitialRange(url, entry, stats, options);
  const headerOffset = entry.localHeaderOffset - entryRange.offset;
  if (readUint32(entryRange.bytes, headerOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error("The APK ZIP local file header is invalid");
  }

  const localCompressionMethod = readUint16(entryRange.bytes, headerOffset + 8);
  const fileNameLength = readUint16(entryRange.bytes, headerOffset + 26);
  const extraLength = readUint16(entryRange.bytes, headerOffset + 28);
  const dataOffset = entry.localHeaderOffset + LOCAL_FILE_HEADER_FIXED_SIZE + fileNameLength + extraLength;
  const compressedBytes = await readEntryCompressedBytes(url, entryRange, dataOffset, entry.compressedSize, stats, options);
  const compressionMethod = localCompressionMethod || entry.compressionMethod;

  if (compressionMethod === ZIP_COMPRESSION_STORE) {
    return compressedBytes;
  }

  if (compressionMethod === ZIP_COMPRESSION_DEFLATE) {
    return inflateRaw(compressedBytes);
  }

  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

async function downloadEntryInitialRange(url, entry, stats, options) {
  const estimatedLength = getEstimatedEntryLocalRangeLength(entry);
  const exactRange = getExactEntryInitialRange(entry.localHeaderOffset, estimatedLength, options);
  const range = hasAvailableRange(options.rangeCache, exactRange.offset, exactRange.length)
    ? exactRange
    : getEntryInitialRange(entry.localHeaderOffset, estimatedLength, entry, options);
  const bytes = await downloadCachedRange(url, range.offset, range.length, stats, options.rangeCache);
  return {
    offset: range.offset,
    bytes,
  };
}

function getEstimatedEntryLocalRangeLength(entry) {
  return (
    LOCAL_FILE_HEADER_FIXED_SIZE +
    (entry.fileNameLength || getUtf8ByteLength(entry.name || "")) +
    (entry.extraLength || 0) +
    entry.compressedSize
  );
}

function getEntryInitialRange(offset, estimatedLength, entry, options) {
  const contentLength = options.contentLength || 0;
  if (
    contentLength > 0 &&
    offset >= SMALL_ENTRY_COALESCE_MIN_OFFSET &&
    entry.compressedSize <= SMALL_ENTRY_COALESCE_MAX_BYTES
  ) {
    const coalescedOffset = offset;
    const coalescedEnd = Math.min(contentLength, coalescedOffset + SMALL_ENTRY_LOOKAHEAD_BYTES);
    const estimatedEnd = Math.min(contentLength, offset + estimatedLength + LOCAL_HEADER_EXTRA_SLOP_BYTES);
    return {
      offset: coalescedOffset,
      length: Math.max(0, Math.max(coalescedEnd, estimatedEnd) - coalescedOffset),
    };
  }

  return getExactEntryInitialRange(offset, estimatedLength, options);
}

function getExactEntryInitialRange(offset, estimatedLength, options) {
  const contentLength = options.contentLength || 0;
  const wantedLength = estimatedLength + LOCAL_HEADER_EXTRA_SLOP_BYTES;
  return {
    offset,
    length: contentLength > 0 ? Math.max(0, Math.min(wantedLength, contentLength - offset)) : wantedLength,
  };
}

async function readEntryCompressedBytes(url, entryRange, dataOffset, compressedSize, stats, options) {
  if (compressedSize <= 0) {
    return new Uint8Array();
  }

  const dataStart = dataOffset - entryRange.offset;
  const dataEnd = dataStart + compressedSize;
  if (dataStart >= 0 && dataEnd <= entryRange.bytes.byteLength) {
    return entryRange.bytes.subarray(dataStart, dataEnd);
  }

  return downloadCachedRange(url, dataOffset, compressedSize, stats, options.rangeCache);
}

function createRangeCache(initialRanges = []) {
  const ranges = [];
  for (const range of Array.isArray(initialRanges) ? initialRanges : [initialRanges]) {
    if (range?.bytes?.byteLength) {
      ranges.push({ offset: range.offset || 0, length: range.bytes.byteLength, bytes: range.bytes });
    }
  }

  return {
    ranges,
    inFlight: new Map(),
  };
}

function prefetchLikelyMetadataRange(url, zipEntries, contentLength, stats, rangeCache) {
  const entries = collectLikelyMetadataEntries(zipEntries);
  const lateEntries = entries.filter((entry) => entry.localHeaderOffset >= SMALL_ENTRY_COALESCE_MIN_OFFSET);
  if (!lateEntries.length || contentLength <= 0) {
    return;
  }

  const offset = Math.min(...lateEntries.map((entry) => entry.localHeaderOffset));
  const length = Math.min(SMALL_ENTRY_LOOKAHEAD_BYTES, contentLength - offset);
  if (hasAvailableRange(rangeCache, offset, length)) {
    return;
  }
  void downloadCachedRange(url, offset, length, stats, rangeCache).catch(() => {});
}

function collectLikelyMetadataEntries(zipEntries) {
  const entries = [];
  for (const [path, entry] of zipEntries.entries()) {
    if (METADATA_PREFETCH_ENTRY_NAMES.has(path) || V1_SIGNATURE_ENTRY_PATTERN.test(path)) {
      entries.push(entry);
    }
  }
  return entries;
}

async function downloadCachedRange(url, offset, length, stats, rangeCache) {
  if (!rangeCache) {
    return downloadRange(url, offset, length, stats);
  }

  const cached = findCachedRange(rangeCache.ranges, offset, length);
  if (cached) {
    stats.rangeCacheHitCount += 1;
    return cached.bytes.subarray(offset - cached.offset, offset - cached.offset + length);
  }

  for (const inFlight of rangeCache.inFlight.values()) {
    if (coversRange(inFlight, offset, length)) {
      const resolved = await inFlight.promise;
      stats.rangeCacheHitCount += 1;
      return resolved.bytes.subarray(offset - resolved.offset, offset - resolved.offset + length);
    }
  }

  const key = `${offset}:${length}`;
  let request = rangeCache.inFlight.get(key);
  if (!request) {
    request = {
      offset,
      length,
      promise: downloadRange(url, offset, length, stats).then((bytes) => {
        const range = { offset, length: bytes.byteLength, bytes };
        rangeCache.ranges.push(range);
        pruneRangeCache(rangeCache.ranges);
        return range;
      }),
    };
    rangeCache.inFlight.set(key, request);
    void request.promise.finally(() => {
      rangeCache.inFlight.delete(key);
    }).catch(() => {});
  }

  const resolved = await request.promise;
  return resolved.bytes.subarray(offset - resolved.offset, offset - resolved.offset + length);
}

function findCachedRange(ranges, offset, length) {
  for (const range of ranges) {
    if (coversRange(range, offset, length)) {
      return range;
    }
  }
  return null;
}

function hasAvailableRange(rangeCache, offset, length) {
  if (!rangeCache) {
    return false;
  }
  if (findCachedRange(rangeCache.ranges, offset, length)) {
    return true;
  }
  for (const inFlight of rangeCache.inFlight.values()) {
    if (coversRange(inFlight, offset, length)) {
      return true;
    }
  }
  return false;
}

function coversRange(range, offset, length) {
  return range.offset <= offset && range.offset + range.length >= offset + length;
}

async function readBufferedOrRemoteRange(url, offset, length, options) {
  const bufferStart = options.bufferOffset;
  const bufferEnd = bufferStart + options.bufferBytes.byteLength;
  const rangeEnd = offset + length;
  if (offset >= bufferStart && rangeEnd <= bufferEnd) {
    options.stats.rangeCacheHitCount += 1;
    return options.bufferBytes.subarray(offset - bufferStart, rangeEnd - bufferStart);
  }

  return downloadRange(url, offset, length, options.stats);
}

function pruneRangeCache(ranges) {
  const maxRanges = 8;
  const maxBytes = 3 * 1024 * 1024;
  let totalBytes = ranges.reduce((total, range) => total + range.bytes.byteLength, 0);

  while (ranges.length > maxRanges || totalBytes > maxBytes) {
    const removed = ranges.shift();
    totalBytes -= removed?.bytes.byteLength || 0;
  }
}

async function downloadRange(url, offset, length, stats) {
  if (length <= 0) {
    return new Uint8Array();
  }

  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) {
    throw new Error("The remote APK offset is outside the current preview parsing range");
  }

  const end = offset + length - 1;
  const response = await fetch(url, {
    headers: {
      ...buildRemoteHeaders(),
      range: `bytes=${offset}-${end}`,
    },
  });

  if (response.status !== 206) {
    await cancelResponseBody(response);
    throw new Error("The remote link does not support HTTP Range, so it cannot be parsed without a full download");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  stats.rangeRequestCount += 1;
  stats.downloadedBytes += bytes.byteLength;
  return bytes;
}

function parseCentralDirectory(bytes) {
  const entries = new Map();
  let offset = 0;

  while (offset + CENTRAL_DIRECTORY_FIXED_HEADER_SIZE <= bytes.length) {
    if (readUint32(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("The APK ZIP central directory is invalid");
    }

    const flags = readUint16(bytes, offset + 8);
    const compressionMethod = readUint16(bytes, offset + 10);
    const fileNameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const nameStart = offset + CENTRAL_DIRECTORY_FIXED_HEADER_SIZE;
    const extraStart = nameStart + fileNameLength;
    const nextOffset = extraStart + extraLength + commentLength;

    if (nextOffset > bytes.length) {
      throw new Error("The APK ZIP central directory entry is out of bounds");
    }

    const rawExtra = bytes.subarray(extraStart, extraStart + extraLength);
    const zip64 = parseZip64Extra(rawExtra);
    const fileName = decodeZipFileName(bytes.subarray(nameStart, nameStart + fileNameLength));
    const compressedSize32 = readUint32(bytes, offset + 20);
    const uncompressedSize32 = readUint32(bytes, offset + 24);
    const localHeaderOffset32 = readUint32(bytes, offset + 42);

    entries.set(fileName, {
      name: fileName,
      flags,
      compressionMethod,
      fileNameLength,
      extraLength,
      compressedSize: compressedSize32 === ZIP64_NO_ENTRY ? zip64.compressedSize : compressedSize32,
      uncompressedSize: uncompressedSize32 === ZIP64_NO_ENTRY ? zip64.uncompressedSize : uncompressedSize32,
      localHeaderOffset: localHeaderOffset32 === ZIP64_NO_ENTRY ? zip64.localHeaderOffset : localHeaderOffset32,
    });

    offset = nextOffset;
  }

  return entries;
}

function parseZip64Extra(rawExtra) {
  const zip64 = {
    uncompressedSize: ZIP64_NO_ENTRY,
    compressedSize: ZIP64_NO_ENTRY,
    localHeaderOffset: ZIP64_NO_ENTRY,
  };
  let offset = 0;

  while (offset + 4 <= rawExtra.length) {
    const headerId = readUint16(rawExtra, offset);
    const dataSize = readUint16(rawExtra, offset + 2);
    const dataStart = offset + 4;
    const dataEnd = dataStart + dataSize;
    if (dataEnd > rawExtra.length) {
      break;
    }

    if (headerId === 0x0001) {
      let cursor = dataStart;
      if (cursor + 8 <= dataEnd) {
        zip64.uncompressedSize = readUint64(rawExtra, cursor);
        cursor += 8;
      }
      if (cursor + 8 <= dataEnd) {
        zip64.compressedSize = readUint64(rawExtra, cursor);
        cursor += 8;
      }
      if (cursor + 8 <= dataEnd) {
        zip64.localHeaderOffset = readUint64(rawExtra, cursor);
      }
      break;
    }

    offset = dataEnd;
  }

  return zip64;
}

function findEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(bytes, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("The APK ZIP end-of-central-directory record is missing");
}

function parseEocd(bytes, offset) {
  if (readUint32(bytes, offset) !== EOCD_SIGNATURE) {
    throw new Error("The APK ZIP end-of-central-directory record is invalid");
  }

  const centralDirectorySize = readUint32(bytes, offset + 12);
  const centralDirectoryOffset = readUint32(bytes, offset + 16);
  if (centralDirectorySize === ZIP64_NO_ENTRY || centralDirectoryOffset === ZIP64_NO_ENTRY) {
    throw new Error("ZIP64 APKs are not supported by link preview");
  }

  return {
    totalEntries: readUint16(bytes, offset + 10),
    centralDirectorySize,
    centralDirectoryOffset,
  };
}

async function inflateRaw(bytes) {
  if (bytes.byteLength === 0) {
    return new Uint8Array();
  }

  const decompressed = new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
  );
  const buffer = await decompressed.arrayBuffer();
  return new Uint8Array(buffer);
}

function parseHttpUrl(rawUrl) {
  const url = new URL(String(rawUrl).trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP/HTTPS APK download links are supported");
  }

  url.hash = "";
  return url;
}

function buildRemoteHeaders() {
  return {
    "accept-encoding": "identity",
    "user-agent": "LibChecker-Telegram-Bot/1.0",
  };
}

function acceptsRange(headers) {
  return headers.get("accept-ranges")?.toLowerCase().includes("bytes") || false;
}

function parseContentLength(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : -1;
}

function parseContentRangeTotal(value) {
  const total = value?.match(/\/(\d+)$/u)?.[1];
  return parseContentLength(total);
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cancellation: avoiding accidental full downloads matters more than this error.
  }
}

function decodeZipFileName(bytes) {
  return utf8Decoder.decode(bytes);
}

function getUtf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function readUint16(bytes, offset) {
  ensureReadable(bytes, offset, 2);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  ensureReadable(bytes, offset, 4);
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function readUint64(bytes, offset) {
  ensureReadable(bytes, offset, 8);
  const low = BigInt(readUint32(bytes, offset));
  const high = BigInt(readUint32(bytes, offset + 4));
  const value = Number((high << 32n) | low);
  if (!Number.isSafeInteger(value)) {
    throw new Error("The remote APK ZIP64 field is outside the current preview parsing range");
  }
  return value;
}

function ensureReadable(bytes, offset, size) {
  if (offset < 0 || offset + size > bytes.length) {
    throw new Error("The APK ZIP data is out of bounds");
  }
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  const precision = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[index]}`;
}
