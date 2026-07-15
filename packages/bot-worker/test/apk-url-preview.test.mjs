import assert from "node:assert/strict";
import test from "node:test";

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
