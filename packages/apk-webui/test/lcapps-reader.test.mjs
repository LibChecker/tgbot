import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";

import { strToU8, zipSync } from "fflate";

import { readLcappsArchive } from "../src/app/lcapps-reader.js";

const NOW_ISO = "2026-07-15T00:00:00.000Z";
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

test("reads deflated LCAPPS JSON and stored icons through the ZIP library", async () => {
  const archive = zipSync({
    "metadata.json": strToU8("not the app list"),
    "apps.json": strToU8(JSON.stringify({
      apps: [{
        appName: "Example",
        packageName: "com.example.app",
        iconPath: "icons/com.example.app.png",
      }],
    })),
    "icons/com.example.app.png": [new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { level: 0 }],
    "ignored.txt": strToU8("not extracted"),
  });

  const result = await readLcappsArchive(createArchiveFile(archive), { nowIso: NOW_ISO });

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].apkInfo.appName, "Example");
  assert.equal(result.reports[0].apkInfo.packageName, "com.example.app");
  assert.equal(result.reports[0].apkInfo.icon.dataUri, "data:image/png;base64,iVBORw==");
});

test("preserves support for local-header streaming ZIPs with data descriptors", async () => {
  const json = strToU8(JSON.stringify({
    apps: [{ appName: "Streamed", packageName: "com.example.streamed" }],
  }));
  const archive = createStreamingZipEntry("apps.json", json);

  const result = await readLcappsArchive(createArchiveFile(archive), { nowIso: NOW_ISO });

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].apkInfo.packageName, "com.example.streamed");
});

test("maps damaged ZIP central directories to the existing invalid-ZIP code", async () => {
  const archive = createBasicArchive();
  const centralOffset = findSignature(archive, CENTRAL_DIRECTORY_SIGNATURE);
  assert.notEqual(centralOffset, -1);
  archive[centralOffset] = 0;

  await assert.rejects(
    readLcappsArchive(createArchiveFile(archive)),
    (error) => error?.code === "lcappsInvalidZip",
  );
});

test("keeps unsupported compression distinct from damaged ZIP data", async () => {
  const archive = createBasicArchive();
  const localOffset = findSignature(archive, LOCAL_FILE_HEADER_SIGNATURE);
  const centralOffset = findSignature(archive, CENTRAL_DIRECTORY_SIGNATURE);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  view.setUint16(localOffset + 8, 99, true);
  view.setUint16(centralOffset + 10, 99, true);

  await assert.rejects(
    readLcappsArchive(createArchiveFile(archive)),
    (error) => error?.code === "lcappsUnsupportedCompression",
  );
});

test("retains the explicit ZIP64 compatibility boundary", async () => {
  const archive = createBasicArchive();
  const eocdOffset = findSignature(archive, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  assert.notEqual(eocdOffset, -1);
  new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    .setUint16(eocdOffset + 10, 0xffff, true);

  await assert.rejects(
    readLcappsArchive(createArchiveFile(archive)),
    (error) => error?.code === "lcappsUnsupportedZip64",
  );
});

test("reports a valid archive without an app-list JSON as missing JSON", async () => {
  const archive = zipSync({
    "readme.txt": strToU8("no reports here"),
    "icon.png": new Uint8Array([1, 2, 3]),
  });

  await assert.rejects(
    readLcappsArchive(createArchiveFile(archive)),
    (error) => error?.code === "lcappsMissingJson",
  );
});

function createBasicArchive() {
  return zipSync({
    "apps.json": strToU8(JSON.stringify({
      apps: [{ appName: "Example", packageName: "com.example.app" }],
    })),
  });
}

function createArchiveFile(bytes) {
  return {
    name: "sample.lcapps",
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function createStreamingZipEntry(name, data) {
  const fileName = strToU8(name);
  const compressed = new Uint8Array(deflateRawSync(data));
  const bytes = new Uint8Array(30 + fileName.byteLength + compressed.byteLength + 16);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  view.setUint32(offset, LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, 0x0008, true);
  view.setUint16(offset + 8, 8, true);
  view.setUint16(offset + 26, fileName.byteLength, true);
  offset += 30;
  bytes.set(fileName, offset);
  offset += fileName.byteLength;
  bytes.set(compressed, offset);
  offset += compressed.byteLength;
  view.setUint32(offset, DATA_DESCRIPTOR_SIGNATURE, true);
  view.setUint32(offset + 8, compressed.byteLength, true);
  view.setUint32(offset + 12, data.byteLength, true);
  return bytes;
}

function findSignature(bytes, signature) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= view.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) {
      return offset;
    }
  }
  return -1;
}
