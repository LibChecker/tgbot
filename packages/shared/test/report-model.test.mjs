import assert from "node:assert/strict";
import test from "node:test";

import { buildApkReportViewModel, getNativeLibraryLabels } from "../src/report-model.js";

test("APK report view model keeps shared report sections aligned", () => {
  const model = buildApkReportViewModel({
    locale: "en",
    fileName: "sample.apk",
    fileSizeBytes: 2048,
    analyzedAt: "2026-07-08T00:00:00.000Z",
    durationMs: 1200,
    terminalSystem: { name: "macOS", version: "15", source: "navigator" },
    apkInfo: {
      appName: "Sample",
      packageName: "com.example.sample",
      versionName: "1.0",
      versionCode: "1",
      targetSdk: 35,
      minSdk: 23,
      compileSdk: 35,
      buildFeatures: {
        kotlinDetected: true,
        kotlinVersion: "2.0",
        agpVersion: "8.7",
      },
      permissions: ["z.permission", "a.permission"],
      nativeLibraries: [
        {
          abi: "arm64-v8a",
          name: "libsample.so",
          size: 16384,
          path: "lib/arm64-v8a/libsample.so",
          elfPageSize: 16384,
        },
      ],
      components: {
        activities: [{ name: "MainActivity" }],
        services: [],
        receivers: [],
        providers: [],
      },
      signatures: {
        schemes: ["v2"],
        certificates: [
          {
            schemes: ["v2"],
            issuer: "CN=Issuer",
            fingerprints: { sha256: "AA:BB" },
          },
        ],
      },
      metaData: { application: [{ name: "meta", value: "value" }] },
      sdkSummary: {
        native: [{ label: "SDK A", count: 2 }],
        components: [{ label: "SDK B", count: 1 }],
      },
    },
  });

  assert.equal(model.summary.stats.signatures, 1);
  assert.deepEqual(model.permissions.items, ["a.permission", "z.permission"]);
  assert.deepEqual(model.summary.features.map((item) => item.text), ["Kotlin 2.0", "AGP 8.7"]);
  assert.equal(model.summary.sdkPreview[0].label, "SDK A");
  assert.equal(model.native.groups[0].abi, "arm64-v8a");
  assert.equal(model.signatures.certificates[0].rows.some((row) => row.key === "sha256"), true);
});

test("native library labels are shared by WebUI and Instant View renderers", () => {
  assert.deepEqual(
    getNativeLibraryLabels({ elfPageSize: 16384, zipAlignment: 4096 }),
    [
      { text: "16 KB", tone: "ok" },
      { text: "4KB ZIPALIGN", tone: "warning" },
    ],
  );
});
