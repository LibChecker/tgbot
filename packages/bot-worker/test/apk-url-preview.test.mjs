import assert from "node:assert/strict";
import test from "node:test";

import { applyNativeLibraryZipAlignments } from "../../shared/src/apk.js";
import { __apkUrlPreviewTestInternals, parseHttpUrl } from "../src/apk-url-preview.js";

const textEncoder = new TextEncoder();

test("parseHttpUrl rejects blocked localhost and private hosts", () => {
  const blockedUrls = [
    "http://localhost/file.apk",
    "https://LOCALHOST/file.apk",
    "http://127.0.0.1/file.apk",
    "http://127.1/file.apk",
    "http://127.0.1/file.apk",
    "http://2130706433/file.apk",
    "http://0x7f000001/file.apk",
    "http://0177.0.0.1/file.apk",
    "http://3232235521/file.apk",
    "http://100.64.0.1/file.apk",
    "http://198.18.0.1/file.apk",
    "http://224.0.0.1/file.apk",
    "https://[::1]/file.apk",
    "https://[::]/file.apk",
    "https://[::ffff:127.0.0.1]/file.apk",
    "http://192.168.1.1/file.apk",
    "https://[fe80::1]/file.apk",
    "https://[fd00::1]/file.apk",
    "https://[fec0::1]/file.apk",
    "https://[ff00::1]/file.apk",
    "http://example.local/file.apk",
    "http://example.local./file.apk",
  ];

  for (const url of blockedUrls) {
    assert.throws(
      () => parseHttpUrl(url),
      (error) => error instanceof Error && error.code === "invalid_download_url",
    );
  }
});

test("parseHttpUrl accepts public URLs and removes URL fragments", () => {
  const url = parseHttpUrl("https://example.com/sample.apk#preview");

  assert.equal(url.href, "https://example.com/sample.apk");

  assert.equal(parseHttpUrl("https://8.8.8.8/sample.apk").hostname, "8.8.8.8");
  assert.equal(parseHttpUrl("https://[2001:4860:4860::8888]/sample.apk").hostname, "[2001:4860:4860::8888]");
});

test("parseHttpUrl enforces supported URL schemes", () => {
  assert.throws(
    () => parseHttpUrl("ftp://example.com/sample.apk"),
    (error) => error instanceof Error && error.code === "invalid_download_url",
  );
});

test("remote ZIP directory parsing retains offsets needed for HTTP Range reads", () => {
  const directory = createCentralDirectoryEntry("AndroidManifest.xml", {
    compressedSize: 123,
    uncompressedSize: 456,
    localHeaderOffset: 789,
  });

  const entries = __apkUrlPreviewTestInternals.parseCentralDirectory(directory);
  assert.deepEqual(entries.get("AndroidManifest.xml"), {
    name: "AndroidManifest.xml",
    flags: 0,
    compressionMethod: 8,
    fileNameLength: 19,
    extraLength: 0,
    compressedSize: 123,
    uncompressedSize: 456,
    localHeaderOffset: 789,
  });
});

test("remote ZIP alignment hydration reads only stored native local headers", async () => {
  const storedNative = {
    name: "lib/arm64-v8a/libstored.so",
    compressionMethod: 0,
    compressedSize: 50,
    localHeaderOffset: 120,
    extraLength: 0,
  };
  const cappedNative = {
    name: "lib/arm64-v8a/libcapped.so",
    compressionMethod: 0,
    compressedSize: 50,
    localHeaderOffset: 320,
  };
  const deflatedNative = {
    name: "lib/arm64-v8a/libdeflated.so",
    compressionMethod: 8,
    compressedSize: 50,
    localHeaderOffset: 520,
  };
  const storedResource = {
    name: "resources.arsc",
    compressionMethod: 0,
    compressedSize: 50,
    localHeaderOffset: 720,
  };
  const entries = new Map([
    [storedNative.name, storedNative],
    [cappedNative.name, cappedNative],
    [deflatedNative.name, deflatedNative],
    [storedResource.name, storedResource],
  ]);
  const localExtraLength = 4096
    - storedNative.localHeaderOffset
    - 30
    - textEncoder.encode(storedNative.name).byteLength;
  const header = createLocalFileHeader(storedNative.name, {
    compressionMethod: 0,
    extraLength: localExtraLength,
  });
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(options.headers.range);
    return new Response(header, { status: 206 });
  };

  const stats = { rangeRequestCount: 0, downloadedBytes: 0, rangeCacheHitCount: 0 };
  try {
    await __apkUrlPreviewTestInternals.hydrateStoredNativeLibraryDataOffsets(
      new URL("https://example.com/sample.apk"),
      entries,
      stats,
      { contentLength: 5000, maxProbes: 1 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    storedNative.dataOffset,
    storedNative.localHeaderOffset + 30 + textEncoder.encode(storedNative.name).byteLength + localExtraLength,
  );
  const nativeLibraries = [{ path: storedNative.name, zipCompression: "store" }];
  applyNativeLibraryZipAlignments(nativeLibraries, entries);
  assert.equal(nativeLibraries[0].zipAlignment, 4096);
  assert.equal(nativeLibraries[0].zip16kbAligned, false);
  assert.equal(cappedNative.dataOffset, undefined);
  assert.equal(deflatedNative.dataOffset, undefined);
  assert.equal(storedResource.dataOffset, undefined);
  assert.deepEqual(requests, ["bytes=120-149"]);
  assert.equal(stats.rangeRequestCount, 1);
  assert.equal(stats.downloadedBytes, 30);
});

test("remote ZIP alignment hydration stops after one failed probe batch", async () => {
  const entries = new Map(Array.from({ length: 10 }, (_, index) => {
    const name = `lib/arm64-v8a/libfailure${index}.so`;
    return [name, {
      name,
      compressionMethod: 0,
      compressedSize: 50,
      localHeaderOffset: 100 + index * 100,
    }];
  }));
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(options.headers.range);
    return new Response(null, { status: 429 });
  };

  const stats = { rangeRequestCount: 0, downloadedBytes: 0, rangeCacheHitCount: 0 };
  try {
    await __apkUrlPreviewTestInternals.hydrateStoredNativeLibraryDataOffsets(
      new URL("https://example.com/sample.apk"),
      entries,
      stats,
      { contentLength: 2000 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 4);
  assert.equal(stats.rangeRequestCount, 4);
  assert.equal(stats.downloadedBytes, 0);
  assert.equal(Array.from(entries.values()).some((entry) => entry.dataOffset != null), false);
});

test("remote ZIP alignment hydration preserves the shared request budget", async () => {
  const entries = new Map(Array.from({ length: 3 }, (_, index) => {
    const name = `lib/arm64-v8a/libbudget${index}.so`;
    return [name, {
      name,
      compressionMethod: 0,
      compressedSize: 50,
      localHeaderOffset: 100 + index * 100,
    }];
  }));
  const header = createLocalFileHeader("lib/arm64-v8a/libbudget0.so", { compressionMethod: 0 });
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(options.headers.range);
    return new Response(header, { status: 206 });
  };

  const stats = { rangeRequestCount: 31, downloadedBytes: 0, rangeCacheHitCount: 0 };
  try {
    await __apkUrlPreviewTestInternals.hydrateStoredNativeLibraryDataOffsets(
      new URL("https://example.com/sample.apk"),
      entries,
      stats,
      { contentLength: 2000 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, ["bytes=100-129"]);
  assert.equal(stats.rangeRequestCount, 32);
  assert.equal(Array.from(entries.values()).filter((entry) => entry.dataOffset != null).length, 1);
});

test("remote ZIP directory parsing rejects damaged and out-of-bounds records", () => {
  const damaged = createCentralDirectoryEntry("AndroidManifest.xml");
  damaged[0] = 0;
  assert.throws(
    () => __apkUrlPreviewTestInternals.parseCentralDirectory(damaged),
    /central directory is invalid/u,
  );

  const outOfBounds = createCentralDirectoryEntry("AndroidManifest.xml");
  new DataView(outOfBounds.buffer).setUint16(28, 0xffff, true);
  assert.throws(
    () => __apkUrlPreviewTestInternals.parseCentralDirectory(outOfBounds),
    /entry is out of bounds/u,
  );
});

test("remote ZIP EOCD parsing keeps the explicit ZIP64 preview boundary", () => {
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, 1, true);
  view.setUint32(12, 46, true);
  view.setUint32(16, 0xffffffff, true);

  assert.throws(
    () => __apkUrlPreviewTestInternals.parseEocd(eocd, 0),
    /ZIP64 APKs are not supported/u,
  );
  assert.throws(
    () => __apkUrlPreviewTestInternals.findEndOfCentralDirectory(new Uint8Array(22)),
    /end-of-central-directory record is missing/u,
  );
});

function createCentralDirectoryEntry(name, options = {}) {
  const nameBytes = textEncoder.encode(name);
  const bytes = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(10, options.compressionMethod ?? 8, true);
  view.setUint32(20, options.compressedSize ?? 10, true);
  view.setUint32(24, options.uncompressedSize ?? 20, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint32(42, options.localHeaderOffset ?? 30, true);
  bytes.set(nameBytes, 46);
  return bytes;
}

function createLocalFileHeader(name, options = {}) {
  const nameBytes = textEncoder.encode(name);
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(8, options.compressionMethod ?? 8, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, options.extraLength ?? 0, true);
  return bytes;
}
