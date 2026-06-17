import assert from "node:assert/strict";
import test from "node:test";

import { __apkTestInternals } from "../src/apk.js";

const textEncoder = new TextEncoder();

test("renders stroked vector paths without implicit black fill", async () => {
  const vectorXml = textEncoder.encode(`
    <vector xmlns:android="http://schemas.android.com/apk/res/android"
        android:width="108dp"
        android:height="108dp"
        android:viewportWidth="24"
        android:viewportHeight="24">
      <path
          android:pathData="M12,3l8,4.5l0,9l-8,4.5l-8,-4.5l0,-9l8,-4.5"
          android:strokeColor="#ffff"
          android:strokeWidth="2"/>
    </vector>
  `);

  const icon = await __apkTestInternals.renderVectorDrawableIcon(
    vectorXml,
    {},
    { resolveColor: () => null },
    { path: "res/drawable/launcher_foreground.xml" },
  );
  const svg = decodeSvgDataUri(icon.dataUri);

  assert.match(svg, /fill="none"/u);
  assert.doesNotMatch(svg, /fill="#000000"/u);
  assert.match(svg, /stroke="#ffffff"/u);
});

test("preserves vector even-odd fill rules", async () => {
  const vectorXml = textEncoder.encode(`
    <vector xmlns:android="http://schemas.android.com/apk/res/android"
        android:width="108dp"
        android:height="108dp"
        android:viewportWidth="24"
        android:viewportHeight="24">
      <path
          android:pathData="M0,0h24v24h-24z M6,6h12v12h-12z"
          android:fillColor="#0058a0"
          android:fillType="evenOdd"/>
    </vector>
  `);

  const icon = await __apkTestInternals.renderVectorDrawableIcon(
    vectorXml,
    {},
    { resolveColor: () => null },
    { path: "res/drawable/launcher_background.xml" },
  );
  const svg = decodeSvgDataUri(icon.dataUri);

  assert.match(svg, /fill-rule="evenodd"/u);
  assert.match(svg, /clip-rule="evenodd"/u);
});

test("prefers renderable vector drawables over bitmap app icon candidates", async () => {
  const vectorPath = "res/mipmap-anydpi-v26/ic_launcher.xml";
  const bitmapPath = "res/mipmap-xxxhdpi/ic_launcher.png";
  const source = createIconSource({
    [vectorPath]: textEncoder.encode(`
      <vector xmlns:android="http://schemas.android.com/apk/res/android"
          android:width="108dp"
          android:height="108dp"
          android:viewportWidth="24"
          android:viewportHeight="24">
        <path
            android:pathData="M12,2l9,20h-18z"
            android:fillColor="#2f80ed"/>
      </vector>
    `),
    [bitmapPath]: createPngHeaderBytes(),
  });
  const icon = await __apkTestInternals.readBestIconCandidate(
    source,
    createIconResources(),
    0x7f010001,
    [
      createIconCandidate(bitmapPath, 640),
      createIconCandidate(vectorPath, 0xfffe),
    ],
  );

  assert.equal(icon.mimeType, "image/svg+xml");
  assert.equal(icon.path, vectorPath);
  assert.match(decodeSvgDataUri(icon.dataUri), /<path /u);
});

test("prefers simple shape drawables over bitmap app icon candidates", async () => {
  const shapePath = "res/drawable/ic_launcher.xml";
  const bitmapPath = "res/drawable-xxxhdpi/ic_launcher.png";
  const source = createIconSource({
    [shapePath]: textEncoder.encode(`
      <shape xmlns:android="http://schemas.android.com/apk/res/android"
          android:shape="rectangle">
        <solid android:color="#2f80ed"/>
      </shape>
    `),
    [bitmapPath]: createPngHeaderBytes(),
  });
  const icon = await __apkTestInternals.readBestIconCandidate(
    source,
    createIconResources(),
    0x7f010002,
    [
      createIconCandidate(bitmapPath, 640),
      createIconCandidate(shapePath, 0),
    ],
  );

  assert.equal(icon.mimeType, "image/svg+xml");
  assert.equal(icon.path, shapePath);
  assert.match(decodeSvgDataUri(icon.dataUri), /fill="#2f80ed"/u);
});

test("annotates native libraries with ELF page size and ZIP alignment", async () => {
  const elfBytes = createElf64WithLoadAlignment(0x4000);
  const zipBytes = createStoredZipWithSingleEntry("lib/arm64-v8a/libpage.so", elfBytes, 4096);
  const zipEntries = __apkTestInternals.parseZipEntries(zipBytes);
  const libraries = await __apkTestInternals.collectNativeLibraries({
    zipEntries,
    apkBytes: zipBytes,
    extractEntry: async (entry) => zipBytes.subarray(entry.dataOffset, entry.dataOffset + entry.uncompressedSize),
  });

  assert.equal(libraries.length, 1);
  assert.equal(libraries[0].name, "libpage.so");
  assert.equal(libraries[0].elfPageSize, 0x4000);
  assert.equal(libraries[0].elf16kbAligned, true);
  assert.equal(libraries[0].zipAlignment, 4096);
  assert.equal(libraries[0].zip16kbAligned, false);
});

function decodeSvgDataUri(dataUri) {
  const [, base64] = dataUri.split(",");
  return Buffer.from(base64, "base64").toString("utf8");
}

function createIconSource(files) {
  const fileEntries = Object.entries(files).map(([path, bytes]) => [
    path,
    {
      path,
      compressedSize: bytes.byteLength,
      uncompressedSize: bytes.byteLength,
    },
  ]);
  const fileMap = new Map(Object.entries(files));
  return {
    zipEntries: new Map(fileEntries),
    extractEntry: async (entry) => fileMap.get(entry.path),
  };
}

function createIconResources() {
  return {
    resolveColor: () => null,
    resolveFiles: () => [],
  };
}

function createIconCandidate(path, density) {
  return {
    path,
    density,
    typeName: path.includes("/mipmap") ? "mipmap" : "drawable",
    isDefaultConfig: path.includes("/mipmap/") || path.includes("/drawable/"),
  };
}

function createPngHeaderBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function createElf64WithLoadAlignment(alignment) {
  const bytes = new Uint8Array(0x80);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46], 0);
  bytes[4] = 2;
  bytes[5] = 1;
  view.setUint16(0x10, 3, true);
  view.setBigUint64(0x20, 0x40n, true);
  view.setUint16(0x36, 0x38, true);
  view.setUint16(0x38, 1, true);
  view.setUint32(0x40, 1, true);
  view.setBigUint64(0x70, BigInt(alignment), true);
  return bytes;
}

function createStoredZipWithSingleEntry(path, data, alignment) {
  const nameBytes = textEncoder.encode(path);
  const localHeaderLength = 30 + nameBytes.length;
  const extraLength = (alignment - (localHeaderLength % alignment)) % alignment;
  const localHeader = new Uint8Array(localHeaderLength + extraLength);
  const localView = new DataView(localHeader.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(18, data.byteLength, true);
  localView.setUint32(22, data.byteLength, true);
  localView.setUint16(26, nameBytes.length, true);
  localView.setUint16(28, extraLength, true);
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

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, centralDirectory.byteLength, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);

  return concatBytes(localHeader, data, centralDirectory, eocd);
}

function concatBytes(...chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
