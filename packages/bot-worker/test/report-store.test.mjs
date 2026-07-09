import assert from "node:assert/strict";
import test from "node:test";

import {
  __reportStoreTestInternals,
  createApkReportDataEntry,
  fetchReportData,
  normalizeReportRef,
} from "../src/report-store.js";

test("R2 report store writes and reads a WebUI-readable Telegram report", async () => {
  const report = createSampleReport();
  report.apkInfo.sdkSummary.native.push({
    key: "sample",
    label: "Sample SDK",
    iconName: "sample",
    iconUrl: "https://example.com/sdk.svg",
    singleColorIcon: false,
    matchSource: "exact",
    regexName: null,
    detailKey: "sample:0",
    ruleDetail: {
      locales: {
        en: {
          label: "Sample SDK",
          description: "Large hover-only detail",
        },
      },
    },
    type: 0,
    count: 1,
    detail: "libsample.so",
    previewItems: ["libsample.so"],
  });

  const bucket = createMemoryBucket();
  const entry = await createApkReportDataEntry({ REPORT_DATA_BUCKET: bucket }, report);
  const storedObject = bucket.objects.get(__reportStoreTestInternals.buildReportDataKey(entry.ref));
  const fetchedReport = await fetchReportData(entry.ref, { REPORT_DATA_BUCKET: bucket });

  assert.match(entry.ref, /^rp_[a-f0-9]{32}$/u);
  assert.equal(normalizeReportRef(entry.ref), entry.ref);
  assert.equal(storedObject.options.httpMetadata.contentType, "application/json; charset=UTF-8");
  assert.deepEqual(storedObject.options.customMetadata, {
    schema_version: "1",
    package_name: "com.example.sample",
  });
  assert.equal(fetchedReport.apkInfo.packageName, "com.example.sample");
  assert.equal(fetchedReport.apkInfo.sdkSummary.native[0].ruleDetail, null);
  assert.equal(normalizeReportRef("Sample-07-08"), "");
  assert.equal(normalizeReportRef("启动遮罩进化-Report-Data-07-08"), "");
});

function createSampleReport() {
  return {
    locale: "en",
    fileName: "sample.apk",
    fileSizeBytes: 2048,
    fileSizeText: "2 KB",
    sourceLabel: "Private Chat Message",
    analyzedAt: "2026-07-08T00:00:00.000Z",
    featureIcons: {
      kotlin: "https://example.com/kotlin.svg",
      gradle: "https://example.com/gradle.svg",
      compose: "https://example.com/compose.svg",
    },
    apkInfo: {
      appName: "Sample",
      packageName: "com.example.sample",
      versionName: "1.0",
      versionCode: "1",
      targetSdk: 35,
      minSdk: 23,
      compileSdk: 35,
      icon: null,
      buildFeatures: {
        kotlinDetected: true,
        kotlinVersion: "2.0",
        agpVersion: "8.7",
      },
      permissions: ["android.permission.INTERNET"],
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
        activities: [{ name: "com.example.MainActivity", exported: true }],
        services: [],
        receivers: [],
        providers: [],
      },
      signatures: {
        schemes: ["v2"],
        certificates: [
          {
            schemes: ["v2"],
            version: "3",
            issuer: "CN=Issuer",
            subject: "CN=Subject",
            validity: {
              notBefore: "2025-01-01T00:00:00.000Z",
              notAfter: "2026-01-01T00:00:00.000Z",
            },
            publicKey: {
              algorithm: "RSA",
              modulusSizeBits: 2048,
            },
            signatureAlgorithm: {
              name: "SHA256withRSA",
            },
            fingerprints: {
              sha256: "AA:BB",
            },
            sourceEntries: ["META-INF/CERT.RSA"],
            derLength: 1024,
          },
        ],
      },
      metaData: {
        application: [{ name: "com.example.KEY", value: "yes" }],
        components: [],
      },
      sdkSummary: {
        native: [],
        components: [],
      },
    },
  };
}

function createMemoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) {
      objects.set(key, { value, options });
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? {
            text: async () => object.value,
          }
        : null;
    },
  };
}
