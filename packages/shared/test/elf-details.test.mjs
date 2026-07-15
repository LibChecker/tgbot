import assert from "node:assert/strict";
import test from "node:test";

import {
  __apkTestInternals,
  readNativeLibraryElfDetails,
} from "../src/apk.js";
import {
  assertElfDetailsWorkerRequest,
  isAnalyzerWorkerMessage,
} from "../src/contracts.js";

const textEncoder = new TextEncoder();

test("parses detailed ELF headers, linking data, symbols, and notes", async () => {
  const elf = createDetailedElf();
  const apk = createStoredZip([
    ["AndroidManifest.xml", Uint8Array.of(0)],
    ["lib/arm64-v8a/libsmoke.so", elf],
  ]);

  const details = await readNativeLibraryElfDetails(apk, {
    path: "lib/arm64-v8a/libsmoke.so",
  });

  assert.equal(details.byteLength, elf.byteLength);
  assert.equal(details.header.class, "ELF64");
  assert.equal(details.header.byteOrder, "Little endian");
  assert.equal(details.header.type, "ET_DYN");
  assert.equal(details.header.machine, "AArch64");
  assert.equal(details.programHeaders[0].type, "PT_LOAD");
  assert.equal(details.programHeaders[0].flags, "R-E");
  assert.equal(details.programHeaders[0].alignment, "0x4000");
  assert.deepEqual(
    details.sectionHeaders.map((section) => section.name),
    ["", ".shstrtab", ".dynstr", ".dynsym", ".dynamic", ".note.gnu.build-id"],
  );
  assert.deepEqual(details.dynamic.needed, ["libc.so"]);
  assert.equal(details.dynamic.soname, "libsmoke.so");
  assert.equal(details.dynamic.entries[0].tag, "DT_NEEDED");
  assert.deepEqual(details.symbols.find((symbol) => symbol.name === "smoke_symbol"), {
    table: ".dynsym",
    index: 1,
    name: "smoke_symbol",
    value: "0x1234",
    size: "0x10",
    binding: "GLOBAL",
    type: "FUNC",
    visibility: "DEFAULT",
    section: "ABS",
  });
  assert.deepEqual(details.notes[0], {
    section: ".note.gnu.build-id",
    owner: "GNU",
    type: "NT_GNU_BUILD_ID",
    description: "0102030405060708090a0b0c0d0e0f1011121314",
    descriptionSize: 20,
  });
  assert.deepEqual(details.counts, {
    programHeaders: 1,
    sectionHeaders: 6,
    dynamicEntries: 3,
    symbols: 2,
    notes: 1,
  });
  assert.deepEqual(details.truncated, {
    programHeaders: false,
    sectionHeaders: false,
    dynamicEntries: false,
    symbols: false,
    notes: false,
  });
});

test("rejects invalid ELF detail locators", async () => {
  await assert.rejects(
    () => readNativeLibraryElfDetails(new Uint8Array(), { path: "../libbad.so" }),
    /Invalid native library path/u,
  );
});

test("validates ELF detail Worker requests and responses", () => {
  const file = {
    name: "sample.apk",
    type: "application/vnd.android.package-archive",
    size: 4,
    arrayBuffer: async () => new ArrayBuffer(4),
  };
  const request = {
    type: "elf-details",
    jobId: 7,
    file,
    library: {
      path: "lib/arm64-v8a/libsmoke.so",
      sourceEntry: "base.apk",
    },
  };

  assert.equal(assertElfDetailsWorkerRequest(request), request);
  assert.throws(
    () => assertElfDetailsWorkerRequest({
      ...request,
      library: { path: "../libsmoke.so" },
    }),
    /Invalid ELF details worker request contract/u,
  );

  const details = __apkTestInternals.parseElfDetails(createDetailedElf());
  assert.equal(isAnalyzerWorkerMessage({
    type: "elf-details-result",
    jobId: 7,
    details,
  }), true);
});

function createDetailedElf() {
  const sectionNames = createStringTable([
    ".shstrtab",
    ".dynstr",
    ".dynsym",
    ".dynamic",
    ".note.gnu.build-id",
  ]);
  const dynamicStrings = createStringTable([
    "libc.so",
    "smoke_symbol",
    "libsmoke.so",
  ]);
  const dynamicSymbols = new Uint8Array(48);
  const symbolView = new DataView(dynamicSymbols.buffer);
  symbolView.setUint32(24, dynamicStrings.offsets.get("smoke_symbol"), true);
  symbolView.setUint8(28, 0x12);
  symbolView.setUint16(30, 0xfff1, true);
  symbolView.setBigUint64(32, 0x1234n, true);
  symbolView.setBigUint64(40, 0x10n, true);

  const dynamic = new Uint8Array(48);
  const dynamicView = new DataView(dynamic.buffer);
  writeDynamicEntry(dynamicView, 0, 1n, BigInt(dynamicStrings.offsets.get("libc.so")));
  writeDynamicEntry(dynamicView, 16, 14n, BigInt(dynamicStrings.offsets.get("libsmoke.so")));
  writeDynamicEntry(dynamicView, 32, 0n, 0n);

  const note = new Uint8Array(36);
  const noteView = new DataView(note.buffer);
  noteView.setUint32(0, 4, true);
  noteView.setUint32(4, 20, true);
  noteView.setUint32(8, 3, true);
  note.set(textEncoder.encode("GNU\0"), 12);
  note.set(Uint8Array.from({ length: 20 }, (_, index) => index + 1), 16);

  let cursor = align8(64 + 56);
  const sectionNameOffset = cursor;
  cursor += sectionNames.bytes.byteLength;
  const dynamicStringOffset = align8(cursor);
  cursor = dynamicStringOffset + dynamicStrings.bytes.byteLength;
  const dynamicSymbolOffset = align8(cursor);
  cursor = dynamicSymbolOffset + dynamicSymbols.byteLength;
  const dynamicOffset = align8(cursor);
  cursor = dynamicOffset + dynamic.byteLength;
  const noteOffset = align8(cursor);
  cursor = noteOffset + note.byteLength;
  const sectionHeaderOffset = align8(cursor);
  const sectionCount = 6;
  const bytes = new Uint8Array(sectionHeaderOffset + sectionCount * 64);
  const view = new DataView(bytes.buffer);

  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 3], 0);
  view.setUint16(16, 3, true);
  view.setUint16(18, 183, true);
  view.setUint32(20, 1, true);
  view.setBigUint64(24, 0x1000n, true);
  view.setBigUint64(32, 64n, true);
  view.setBigUint64(40, BigInt(sectionHeaderOffset), true);
  view.setUint16(52, 64, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, 1, true);
  view.setUint16(58, 64, true);
  view.setUint16(60, sectionCount, true);
  view.setUint16(62, 1, true);

  view.setUint32(64, 1, true);
  view.setUint32(68, 5, true);
  view.setBigUint64(72, 0n, true);
  view.setBigUint64(80, 0x1000n, true);
  view.setBigUint64(88, 0x1000n, true);
  view.setBigUint64(96, BigInt(bytes.byteLength), true);
  view.setBigUint64(104, BigInt(bytes.byteLength), true);
  view.setBigUint64(112, 0x4000n, true);

  bytes.set(sectionNames.bytes, sectionNameOffset);
  bytes.set(dynamicStrings.bytes, dynamicStringOffset);
  bytes.set(dynamicSymbols, dynamicSymbolOffset);
  bytes.set(dynamic, dynamicOffset);
  bytes.set(note, noteOffset);

  writeSection(view, sectionHeaderOffset, 1, sectionNames.offsets.get(".shstrtab"), 3, 0n, sectionNameOffset, sectionNames.bytes.byteLength, 0, 0, 1n, 0n);
  writeSection(view, sectionHeaderOffset, 2, sectionNames.offsets.get(".dynstr"), 3, 2n, dynamicStringOffset, dynamicStrings.bytes.byteLength, 0, 0, 1n, 0n);
  writeSection(view, sectionHeaderOffset, 3, sectionNames.offsets.get(".dynsym"), 11, 2n, dynamicSymbolOffset, dynamicSymbols.byteLength, 2, 1, 8n, 24n);
  writeSection(view, sectionHeaderOffset, 4, sectionNames.offsets.get(".dynamic"), 6, 3n, dynamicOffset, dynamic.byteLength, 2, 0, 8n, 16n);
  writeSection(view, sectionHeaderOffset, 5, sectionNames.offsets.get(".note.gnu.build-id"), 7, 2n, noteOffset, note.byteLength, 0, 0, 4n, 0n);
  return bytes;
}

function writeDynamicEntry(view, offset, tag, value) {
  view.setBigUint64(offset, tag, true);
  view.setBigUint64(offset + 8, value, true);
}

function writeSection(view, tableOffset, index, name, type, flags, offset, size, link, info, alignment, entrySize) {
  const base = tableOffset + index * 64;
  view.setUint32(base, name, true);
  view.setUint32(base + 4, type, true);
  view.setBigUint64(base + 8, flags, true);
  view.setBigUint64(base + 24, BigInt(offset), true);
  view.setBigUint64(base + 32, BigInt(size), true);
  view.setUint32(base + 40, link, true);
  view.setUint32(base + 44, info, true);
  view.setBigUint64(base + 48, alignment, true);
  view.setBigUint64(base + 56, entrySize, true);
}

function createStringTable(values) {
  const offsets = new Map();
  const chunks = [Uint8Array.of(0)];
  let offset = 1;
  for (const value of values) {
    const bytes = textEncoder.encode(value + "\0");
    offsets.set(value, offset);
    chunks.push(bytes);
    offset += bytes.byteLength;
  }
  return { bytes: concatBytes(...chunks), offsets };
}

function createStoredZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const [path, data] of entries) {
    const name = textEncoder.encode(path);
    const local = new Uint8Array(30 + name.byteLength + data.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(data, 30 + name.byteLength);
    localChunks.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, data.byteLength, true);
    centralView.setUint32(24, data.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralChunks.push(central);
    localOffset += local.byteLength;
  }

  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, localOffset, true);
  return concatBytes(...localChunks, ...centralChunks, eocd);
}

function concatBytes(...chunks) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function align8(value) {
  return (value + 7) & ~7;
}
