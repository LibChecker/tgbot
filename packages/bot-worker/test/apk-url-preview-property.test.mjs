import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { __apkUrlPreviewTestInternals } from "../src/apk-url-preview.js";

const textEncoder = new TextEncoder();
const PROPERTY_RUNS = 200;
const zipPathArbitrary = fc.constantFrom(
  "AndroidManifest.xml",
  "resources.arsc",
  "classes.dex",
  "lib/arm64-v8a/libsample.so",
  "splits/base.apk",
);

test("remote central-directory metadata round-trips across bounded values", () => {
  fc.assert(
    fc.property(
      zipPathArbitrary,
      fc.integer({ min: 0, max: 0xffff }),
      fc.constantFrom(0, 8),
      fc.integer({ min: 0, max: 0xfffffffe }),
      fc.integer({ min: 0, max: 0xfffffffe }),
      fc.integer({ min: 0, max: 0xfffffffe }),
      fc.uint8Array({ maxLength: 32 }),
      fc.uint8Array({ maxLength: 32 }),
      (name, flags, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset, extra, comment) => {
        const directory = createCentralDirectoryEntry(name, {
          flags,
          compressionMethod,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
          extra,
          comment,
        });
        const entries = __apkUrlPreviewTestInternals.parseCentralDirectory(directory);

        assert.deepEqual(entries.get(name), {
          name,
          flags,
          compressionMethod,
          fileNameLength: textEncoder.encode(name).byteLength,
          extraLength: extra.byteLength,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
        });
      },
    ),
    { numRuns: PROPERTY_RUNS },
  );
});

test("truncated remote directory entries always stay in the damaged-input path", () => {
  fc.assert(
    fc.property(zipPathArbitrary, (name) => {
      const directory = createCentralDirectoryEntry(name);
      const truncated = directory.subarray(0, directory.byteLength - 1);

      assert.throws(
        () => __apkUrlPreviewTestInternals.parseCentralDirectory(truncated),
        /entry is out of bounds/u,
      );
    }),
    { numRuns: PROPERTY_RUNS },
  );
});

test("EOCD offsets and bounded metadata round-trip without ZIP64 ambiguity", () => {
  fc.assert(
    fc.property(
      fc.uint8Array({ maxLength: 96 }),
      fc.integer({ min: 0, max: 0xffff }),
      fc.integer({ min: 0, max: 0xfffffffe }),
      fc.integer({ min: 0, max: 0xfffffffe }),
      fc.integer({ min: 0, max: 64 }),
      (prefix, totalEntries, centralDirectorySize, centralDirectoryOffset, suffixLength) => {
        const eocd = createEocd({ totalEntries, centralDirectorySize, centralDirectoryOffset });
        const bytes = concatBytes(prefix, eocd, new Uint8Array(suffixLength).fill(0x61));
        const eocdOffset = __apkUrlPreviewTestInternals.findEndOfCentralDirectory(bytes);

        assert.equal(eocdOffset, prefix.byteLength);
        assert.deepEqual(__apkUrlPreviewTestInternals.parseEocd(bytes, eocdOffset), {
          totalEntries,
          centralDirectorySize,
          centralDirectoryOffset,
        });
      },
    ),
    { numRuns: PROPERTY_RUNS },
  );
});

function createCentralDirectoryEntry(name, options = {}) {
  const nameBytes = textEncoder.encode(name);
  const extra = options.extra || new Uint8Array();
  const comment = options.comment || new Uint8Array();
  const bytes = new Uint8Array(46 + nameBytes.byteLength + extra.byteLength + comment.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, options.flags ?? 0, true);
  view.setUint16(10, options.compressionMethod ?? 8, true);
  view.setUint32(20, options.compressedSize ?? 10, true);
  view.setUint32(24, options.uncompressedSize ?? 20, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint16(30, extra.byteLength, true);
  view.setUint16(32, comment.byteLength, true);
  view.setUint32(42, options.localHeaderOffset ?? 30, true);
  bytes.set(nameBytes, 46);
  bytes.set(extra, 46 + nameBytes.byteLength);
  bytes.set(comment, 46 + nameBytes.byteLength + extra.byteLength);
  return bytes;
}

function createEocd(options) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, options.totalEntries, true);
  view.setUint16(10, options.totalEntries, true);
  view.setUint32(12, options.centralDirectorySize, true);
  view.setUint32(16, options.centralDirectoryOffset, true);
  return bytes;
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
