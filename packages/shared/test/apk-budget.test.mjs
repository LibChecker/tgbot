import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { readAndroidPackageInfo, __apkTestInternals } from "../src/apk.js";
import { createSmokeApk, createStoredZip } from "../../apk-webui/test-browser/fixtures.mjs";

test("extraction budgets preserve normal reports and reject exhausted container budgets", async () => {
  const apk = createSmokeApk();
  assert.deepEqual(await readAndroidPackageInfo(apk, { maxExtractedBytes: 100000 }), await readAndroidPackageInfo(apk));
  await assert.rejects(readAndroidPackageInfo(apk, { maxExtractedBytes: 1 }), /budget/);
  const container = createStoredZip([["base.apk", apk], ["split.apk", apk]]);
  await assert.rejects(readAndroidPackageInfo(container, { maxExtractedBytes: apk.length }), /budget/);
  const info = await readAndroidPackageInfo(container, { maxExtractedBytes: 100000 });
  assert.equal(info.archive.analyzedEntry, "base.apk");
  for (const value of [0, -1, NaN, Infinity]) {
    await assert.rejects(readAndroidPackageInfo(apk, { maxExtractedBytes: value }), /Invalid extraction budget/);
  }
});

test("dishonest compressed sizes cannot bypass the extraction budget", async () => {
  const apk = createSmokeApk();
  const entries = __apkTestInternals.parseZipEntries(apk);
  const manifest = entries.get("AndroidManifest.xml");
  const offset = manifest.localHeaderOffset;
  const nameLength = apk.readUInt16LE(offset + 26);
  const extraLength = apk.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = deflateRawSync(apk.subarray(start, start + manifest.compressedSize));
  const zip = Buffer.from(createStoredZip([["AndroidManifest.xml", compressed]]));
  zip.writeUInt16LE(8, 8);
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt16LE(8, central + 10);
  zip.writeUInt32LE(1, central + 24);
  await assert.rejects(readAndroidPackageInfo(zip, { maxExtractedBytes: 100000 }), /declared extraction size/);
});
