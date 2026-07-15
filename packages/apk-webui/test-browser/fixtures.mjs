const textEncoder = new TextEncoder();
const NO_INDEX = 0xffffffff;

export function createSmokeApk() {
  const manifest = createBinaryManifest();
  return Buffer.from(createStoredZip([
    ["AndroidManifest.xml", manifest],
    ["lib/arm64-v8a/libsmoke.so", createSmokeElf()],
  ]));
}

function createSmokeElf() {
  const bytes = new Uint8Array(120);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 3], 0);
  view.setUint16(16, 3, true);
  view.setUint16(18, 183, true);
  view.setUint32(20, 1, true);
  view.setBigUint64(24, 0x1000n, true);
  view.setBigUint64(32, 64n, true);
  view.setUint16(52, 64, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, 1, true);
  view.setUint16(58, 64, true);

  view.setUint32(64, 1, true);
  view.setUint32(68, 5, true);
  view.setBigUint64(72, 0n, true);
  view.setBigUint64(80, 0x1000n, true);
  view.setBigUint64(88, 0x1000n, true);
  view.setBigUint64(96, BigInt(bytes.byteLength), true);
  view.setBigUint64(104, BigInt(bytes.byteLength), true);
  view.setBigUint64(112, 0x4000n, true);
  return bytes;
}

function createBinaryManifest() {
  const strings = [
    "manifest",
    "package",
    "com.example.smoke",
    "versionName",
    "1.0",
    "versionCode",
    "1",
    "compileSdkVersion",
    "35",
    "uses-sdk",
    "minSdkVersion",
    "23",
    "targetSdkVersion",
    "application",
    "label",
    "Smoke APK",
  ];
  const stringIndexes = new Map(strings.map((value, index) => [value, index]));
  const chunks = [
    createStringPool(strings),
    createStartElement(stringIndexes, "manifest", [
      ["package", "com.example.smoke"],
      ["versionName", "1.0"],
      ["versionCode", "1"],
      ["compileSdkVersion", "35"],
    ]),
    createStartElement(stringIndexes, "uses-sdk", [
      ["minSdkVersion", "23"],
      ["targetSdkVersion", "35"],
    ]),
    createEndElement(stringIndexes, "uses-sdk"),
    createStartElement(stringIndexes, "application", [
      ["label", "Smoke APK"],
    ]),
    createEndElement(stringIndexes, "application"),
    createEndElement(stringIndexes, "manifest"),
  ];
  const fileSize = 8 + chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0x0003, true);
  view.setUint16(2, 8, true);
  view.setUint32(4, fileSize, true);
  return concatBytes(header, ...chunks);
}

function createStringPool(strings) {
  const encodedStrings = strings.map((value) => {
    const data = textEncoder.encode(value);
    if (value.length >= 0x80 || data.byteLength >= 0x80) {
      throw new Error("Smoke manifest strings must use one-byte UTF-8 lengths");
    }
    return Uint8Array.from([value.length, data.byteLength, ...data, 0]);
  });
  const offsets = [];
  let stringsSize = 0;
  for (const encoded of encodedStrings) {
    offsets.push(stringsSize);
    stringsSize += encoded.byteLength;
  }
  const stringsStart = 28 + strings.length * 4;
  const chunkSize = align4(stringsStart + stringsSize);
  const chunk = new Uint8Array(chunkSize);
  const view = new DataView(chunk.buffer);
  view.setUint16(0, 0x0001, true);
  view.setUint16(2, 28, true);
  view.setUint32(4, chunkSize, true);
  view.setUint32(8, strings.length, true);
  view.setUint32(16, 0x00000100, true);
  view.setUint32(20, stringsStart, true);
  offsets.forEach((offset, index) => view.setUint32(28 + index * 4, offset, true));
  let offset = stringsStart;
  for (const encoded of encodedStrings) {
    chunk.set(encoded, offset);
    offset += encoded.byteLength;
  }
  return chunk;
}

function createStartElement(indexes, name, attributes) {
  const chunkSize = 36 + attributes.length * 20;
  const chunk = new Uint8Array(chunkSize);
  const view = new DataView(chunk.buffer);
  view.setUint16(0, 0x0102, true);
  view.setUint16(2, 16, true);
  view.setUint32(4, chunkSize, true);
  view.setUint32(16, NO_INDEX, true);
  view.setUint32(20, getStringIndex(indexes, name), true);
  view.setUint16(24, 20, true);
  view.setUint16(26, 20, true);
  view.setUint16(28, attributes.length, true);

  attributes.forEach(([attributeName, value], index) => {
    const offset = 36 + index * 20;
    const valueIndex = getStringIndex(indexes, value);
    view.setUint32(offset, NO_INDEX, true);
    view.setUint32(offset + 4, getStringIndex(indexes, attributeName), true);
    view.setUint32(offset + 8, valueIndex, true);
    view.setUint16(offset + 12, 8, true);
    view.setUint8(offset + 15, 0x03);
    view.setUint32(offset + 16, valueIndex, true);
  });
  return chunk;
}

function createEndElement(indexes, name) {
  const chunk = new Uint8Array(24);
  const view = new DataView(chunk.buffer);
  view.setUint16(0, 0x0103, true);
  view.setUint16(2, 16, true);
  view.setUint32(4, chunk.byteLength, true);
  view.setUint32(16, NO_INDEX, true);
  view.setUint32(20, getStringIndex(indexes, name), true);
  return chunk;
}

function getStringIndex(indexes, value) {
  const index = indexes.get(value);
  if (index == null) {
    throw new Error(`Missing smoke manifest string: ${value}`);
  }
  return index;
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

function align4(value) {
  return (value + 3) & ~3;
}
