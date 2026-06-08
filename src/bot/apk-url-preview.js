import { readApkInfoFromZipSource } from "../shared/apk.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const ZIP64_NO_ENTRY = 0xffffffff;
const EOCD_PROBE_BYTES = 65_536;
const CENTRAL_DIRECTORY_FIXED_HEADER_SIZE = 46;
const LOCAL_FILE_HEADER_FIXED_SIZE = 30;
const DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_COMPRESSED_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_RESOURCE_BYTES = 12 * 1024 * 1024;

const utf8Decoder = new TextDecoder();

export async function readApkInfoFromUrl(rawUrl, options = {}) {
  const apkUrl = parseHttpUrl(rawUrl);
  const stats = {
    mode: "range",
    rangeRequestCount: 0,
    downloadedBytes: 0,
  };
  const metadata = await fetchRemoteMetadata(apkUrl, stats);

  if (!metadata.contentLength || metadata.contentLength <= 0) {
    throw new Error("远端链接没有返回 Content-Length，无法定位 APK ZIP 中央目录");
  }

  const tailStart = Math.max(0, metadata.contentLength - EOCD_PROBE_BYTES);
  const tailBytes = await downloadRange(apkUrl, tailStart, metadata.contentLength - tailStart, stats);
  const eocdOffsetInTail = findEndOfCentralDirectory(tailBytes);
  const eocd = parseEocd(tailBytes, eocdOffsetInTail);
  const maxCentralDirectoryBytes = options.maxCentralDirectoryBytes ?? DEFAULT_MAX_CENTRAL_DIRECTORY_BYTES;

  if (eocd.centralDirectorySize > maxCentralDirectoryBytes) {
    throw new Error(`远端 APK 中央目录过大，当前预览上限为 ${formatBytes(maxCentralDirectoryBytes)}`);
  }

  const centralDirectoryBytes = await downloadRange(
    apkUrl,
    eocd.centralDirectoryOffset,
    eocd.centralDirectorySize,
    stats,
  );
  const zipEntries = parseCentralDirectory(centralDirectoryBytes);
  const maxEntryCompressedBytes = options.maxEntryCompressedBytes ?? DEFAULT_MAX_ENTRY_COMPRESSED_BYTES;
  const source = {
    zipEntries,
    extractEntry: (entry) =>
      downloadRemoteZipEntry(apkUrl, entry, stats, {
        maxEntryCompressedBytes,
      }),
  };

  const apkInfo = await readApkInfoFromZipSource(source, {
    scanDex: false,
    maxResourceBytes: options.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES,
  });

  return {
    apkInfo,
    url: apkUrl.toString(),
    fileName: inferFileNameFromUrl(apkUrl),
    fileSize: metadata.contentLength,
    metadata,
    stats,
  };
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
  const headResult = await fetchHeadMetadata(url);
  if (headResult?.contentLength > 0) {
    return headResult;
  }

  const probeResult = await fetchRangeProbeMetadata(url, stats);
  if (probeResult?.contentLength > 0) {
    return probeResult;
  }

  throw new Error("远端链接不支持 HTTP Range，无法在不完整下载的情况下解析");
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
      range: "bytes=0-0",
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
  };
}

async function downloadRemoteZipEntry(url, entry, stats, options) {
  if ((entry.flags & 0x0001) !== 0) {
    throw new Error("暂不支持解析已加密的 ZIP 条目");
  }

  if (entry.compressedSize > options.maxEntryCompressedBytes) {
    throw new Error(`远端 APK 条目 ${entry.name || ""} 过大，当前预览上限为 ${formatBytes(options.maxEntryCompressedBytes)}`);
  }

  const headerBytes = await downloadRange(url, entry.localHeaderOffset, LOCAL_FILE_HEADER_FIXED_SIZE, stats);
  if (readUint32(headerBytes, 0) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error("APK ZIP 本地文件头损坏");
  }

  const localCompressionMethod = readUint16(headerBytes, 8);
  const fileNameLength = readUint16(headerBytes, 26);
  const extraLength = readUint16(headerBytes, 28);
  const dataOffset = entry.localHeaderOffset + LOCAL_FILE_HEADER_FIXED_SIZE + fileNameLength + extraLength;
  const compressedBytes = await downloadRange(url, dataOffset, entry.compressedSize, stats);
  const compressionMethod = localCompressionMethod || entry.compressionMethod;

  if (compressionMethod === ZIP_COMPRESSION_STORE) {
    return compressedBytes;
  }

  if (compressionMethod === ZIP_COMPRESSION_DEFLATE) {
    return inflateRaw(compressedBytes);
  }

  throw new Error(`不支持的 ZIP 压缩方式: ${compressionMethod}`);
}

async function downloadRange(url, offset, length, stats) {
  if (length <= 0) {
    return new Uint8Array();
  }

  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) {
    throw new Error("远端 APK 偏移量超出当前预览解析范围");
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
    throw new Error("远端链接不支持 HTTP Range，无法在不完整下载的情况下解析");
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
      throw new Error("APK ZIP 中央目录损坏");
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
      throw new Error("APK ZIP 中央目录条目越界");
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

  throw new Error("APK ZIP 结束记录不存在");
}

function parseEocd(bytes, offset) {
  if (readUint32(bytes, offset) !== EOCD_SIGNATURE) {
    throw new Error("APK ZIP 结束记录损坏");
  }

  const centralDirectorySize = readUint32(bytes, offset + 12);
  const centralDirectoryOffset = readUint32(bytes, offset + 16);
  if (centralDirectorySize === ZIP64_NO_ENTRY || centralDirectoryOffset === ZIP64_NO_ENTRY) {
    throw new Error("暂不支持通过链接预览解析 ZIP64 APK");
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
    throw new Error("仅支持 HTTP/HTTPS APK 下载链接");
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
    throw new Error("远端 APK ZIP64 字段超出当前预览解析范围");
  }
  return value;
}

function ensureReadable(bytes, offset, size) {
  if (offset < 0 || offset + size > bytes.length) {
    throw new Error("APK ZIP 数据越界");
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
