import assert from "node:assert/strict";
import test from "node:test";

import { __apkTestInternals, readApkInfoFromZipSource } from "../src/apk.js";

const textEncoder = new TextEncoder();

test("uses optional parser profile hooks for APK hot paths", async () => {
  const calls = [];
  const source = createSource({
    "AndroidManifest.xml": new Uint8Array([1]),
    "resources.arsc": new Uint8Array([2]),
    "classes.dex": new Uint8Array([3]),
    "META-INF/CERT.RSA": new Uint8Array([4]),
  });

  const parserProfile = {
    parseAndroidManifest() {
      calls.push("manifest");
      return createManifest({ applicationLabelRef: 0x7f010001 });
    },
    parseResourcesTable() {
      calls.push("resources");
      return createResources("Wasm App");
    },
    scanDexFeatureMarkers() {
      calls.push("dex");
      return {
        kotlinDetected: true,
        composeDetected: true,
        nativeValidation: {
          qihooDetected: false,
          secneoDetected: false,
          flutterInjectorDetected: false,
        },
      };
    },
    readApkSignatures() {
      calls.push("signatures");
      return {
        schemes: ["WASM"],
        certificates: [],
      };
    },
  };

  const info = await readApkInfoFromZipSource(source, { parserProfile });

  assert.equal(info.packageName, "com.example.profile");
  assert.equal(info.appName, "Wasm App");
  assert.deepEqual(info.signatures.schemes, ["WASM"]);
  assert.equal(info.buildFeatures.kotlinDetected, true);
  assert.equal(info.buildFeatures.composeDetected, true);
  assert.deepEqual(calls.sort(), ["dex", "manifest", "resources", "signatures"]);
});

test("falls back to JS parser paths when optional parser hooks fail", async () => {
  let dexHookCalls = 0;
  let signatureHookCalls = 0;
  let resourcesHookCalls = 0;
  const source = createSource({
    "AndroidManifest.xml": new Uint8Array([1]),
    "resources.arsc": new Uint8Array([2]),
    "classes.dex": new Uint8Array([3]),
  });

  const info = await readApkInfoFromZipSource(source, {
    parserProfile: {
      parseAndroidManifest: () => createManifest({ applicationLabel: "JS Fallback" }),
      async parseResourcesTable() {
        resourcesHookCalls += 1;
        throw new Error("wasm resources unavailable");
      },
      async scanDexFeatureMarkers() {
        dexHookCalls += 1;
        throw new Error("wasm dex unavailable");
      },
      async readApkSignatures() {
        signatureHookCalls += 1;
        throw new Error("wasm signatures unavailable");
      },
    },
  });

  assert.equal(info.appName, "JS Fallback");
  assert.deepEqual(info.signatures.schemes, []);
  assert.equal(info.buildFeatures.kotlinDetected, false);
  assert.equal(resourcesHookCalls, 1);
  assert.equal(dexHookCalls, 1);
  assert.equal(signatureHookCalls, 1);
});

test("uses and falls back from the optional ZIP parser profile hook", () => {
  const profileEntries = new Map([["AndroidManifest.xml", {}]]);
  assert.equal(
    __apkTestInternals.parseZipEntries(new Uint8Array(), {
      parseZipEntries: () => profileEntries,
    }),
    profileEntries,
  );

  const zipBytes = createStoredZipWithSingleEntry("AndroidManifest.xml", new Uint8Array([1]));
  const fallbackEntries = __apkTestInternals.parseZipEntries(zipBytes, {
    parseZipEntries() {
      throw new Error("wasm zip unavailable");
    },
  });

  assert.equal(fallbackEntries.has("AndroidManifest.xml"), true);
});

test("rejects damaged or missing ZIP directory records in the JS fallback", () => {
  const zipBytes = createStoredZipWithSingleEntry("AndroidManifest.xml", new Uint8Array([1]));
  const damagedBytes = zipBytes.slice();
  const centralDirectoryOffset = findZipSignature(damagedBytes, 0x02014b50);
  assert.notEqual(centralDirectoryOffset, -1);
  damagedBytes[centralDirectoryOffset] = 0;

  assert.throws(
    () => __apkTestInternals.parseZipEntries(damagedBytes),
    /APK ZIP 中央目录损坏/u,
  );
  assert.throws(
    () => __apkTestInternals.parseZipEntries(zipBytes.subarray(0, zipBytes.byteLength - 22)),
    /APK ZIP 结束记录不存在/u,
  );
});

function createSource(files) {
  const fileMap = new Map(Object.entries(files));
  const zipEntries = new Map(
    Object.entries(files).map(([path, bytes]) => [
      path,
      {
        path,
        flags: 0,
        compressionMethod: 0,
        compressedSize: bytes.byteLength,
        uncompressedSize: bytes.byteLength,
      },
    ]),
  );
  return {
    zipEntries,
    extractEntry: async (entry) => fileMap.get(entry.path) || new Uint8Array(),
  };
}

function createManifest(overrides = {}) {
  return {
    packageName: "com.example.profile",
    versionName: "1.0",
    versionCode: "1",
    minSdk: "23",
    targetSdk: "35",
    compileSdk: "35",
    applicationLabel: null,
    applicationLabelRef: null,
    applicationIconRef: null,
    applicationRoundIconRef: null,
    permissions: [],
    components: {
      activities: [],
      services: [],
      receivers: [],
      providers: [],
    },
    metaData: {
      application: [],
      components: [],
    },
    ...overrides,
  };
}

function createResources(appName) {
  return {
    resolveString: () => appName,
    resolveFiles: () => [],
    resolveColor: () => null,
  };
}

function createStoredZipWithSingleEntry(path, data) {
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

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, 1, true);
  eocdView.setUint16(10, 1, true);
  eocdView.setUint32(12, centralDirectory.byteLength, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);

  return concatBytes(localHeader, data, centralDirectory, eocd);
}

function findZipSignature(bytes, signature) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= view.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) {
      return offset;
    }
  }
  return -1;
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
