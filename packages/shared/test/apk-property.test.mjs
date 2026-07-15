import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { readApkSignatures } from "../src/apk-signatures.js";
import { __apkTestInternals } from "../src/apk.js";

const textEncoder = new TextEncoder();
const PROPERTY_RUNS = 200;
const keptZipPathArbitrary = fc.constantFrom(
  "AndroidManifest.xml",
  "resources.arsc",
  "classes.dex",
  "classes2.dex",
  "lib/arm64-v8a/libsample.so",
  "res/drawable/icon.xml",
  "META-INF/CERT.RSA",
  "splits/base.apk",
);

test("stored ZIP metadata round-trips across bounded entry payloads", () => {
  fc.assert(
    fc.property(
      keptZipPathArbitrary,
      fc.uint8Array({ maxLength: 1024 }),
      fc.integer({ min: 0, max: 64 }),
      (path, data, archiveCommentLength) => {
        const archiveComment = new Uint8Array(archiveCommentLength).fill(0x61);
        const zipBytes = createStoredZipWithSingleEntry(path, data, archiveComment);
        const entries = __apkTestInternals.parseZipEntries(zipBytes);
        const entry = entries.get(path);

        assert.equal(entries.size, 1);
        assert.ok(entry);
        assert.equal(entry.compressionMethod, 0);
        assert.equal(entry.compressedSize, data.byteLength);
        assert.equal(entry.uncompressedSize, data.byteLength);
        assert.equal(entry.localHeaderOffset, 0);
        assert.equal(entry.dataOffset, 30 + textEncoder.encode(path).byteLength);
      },
    ),
    { numRuns: PROPERTY_RUNS },
  );
});

test("truncated EOCD records always retain the damaged-ZIP boundary", () => {
  fc.assert(
    fc.property(
      keptZipPathArbitrary,
      fc.uint8Array({ maxLength: 256 }),
      fc.integer({ min: 1, max: 22 }),
      (path, data, cutBytes) => {
        const zipBytes = createStoredZipWithSingleEntry(path, data);
        const truncated = zipBytes.subarray(0, zipBytes.byteLength - cutBytes);

        assert.throws(
          () => __apkTestInternals.parseZipEntries(truncated),
          /APK ZIP 结束记录不存在/u,
        );
      },
    ),
    { numRuns: PROPERTY_RUNS },
  );
});

test("bounded damaged DER signature entries never escape the parser contract", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uint8Array({ maxLength: 1024 }), async (signatureBytes) => {
      const entry = {
        path: "META-INF/CERT.RSA",
        compressedSize: signatureBytes.byteLength,
        uncompressedSize: signatureBytes.byteLength,
      };
      const result = await readApkSignatures({
        zipEntries: new Map([[entry.path, entry]]),
        extractEntry: async () => signatureBytes,
      });

      assert.deepEqual(result.schemes, ["V1"]);
      assert.ok(Array.isArray(result.certificates));
      if (result.warnings) {
        assert.ok(result.warnings.every((warning) => typeof warning === "string"));
      }
    }),
    { numRuns: PROPERTY_RUNS },
  );
});

function createStoredZipWithSingleEntry(path, data, archiveComment = new Uint8Array()) {
  const nameBytes = textEncoder.encode(path);
  const localHeader = new Uint8Array(30 + nameBytes.length);
  const localView = new DataView(localHeader.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(18, data.byteLength, true);
  localView.setUint32(22, data.byteLength, true);
  localView.setUint16(26, nameBytes.length, true);
  localHeader.set(nameBytes, 30);

  const centralDirectoryOffset = localHeader.byteLength + data.byteLength;
  const centralDirectory = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(centralDirectory.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(20, data.byteLength, true);
  centralView.setUint32(24, data.byteLength, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralDirectory.set(nameBytes, 46);

  const eocd = new Uint8Array(22 + archiveComment.byteLength);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, centralDirectory.byteLength, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);
  eocdView.setUint16(20, archiveComment.byteLength, true);
  eocd.set(archiveComment, 22);

  return concatBytes(localHeader, data, centralDirectory, eocd);
}

function concatBytes(...chunks) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
