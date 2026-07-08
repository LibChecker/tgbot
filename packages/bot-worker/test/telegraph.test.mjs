import assert from "node:assert/strict";
import test from "node:test";

import { createI18n } from "../src/i18n.js";
import { __telegraphTestInternals } from "../src/telegraph.js";

test("Instant View report content follows the shared APK report view model", () => {
  const report = {
    locale: "en",
    fileName: "sample.apk",
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
  const { t } = createI18n("en");
  const content = __telegraphTestInternals.buildTelegraphContent(report, t);
  const text = collectNodeText(content);

  assert.match(text, /Signatures/u);
  assert.match(text, /SHA256/u);
  assert.match(text, /AA:BB/u);
  assert.match(text, /16 KB/u);
  assert.match(text, /Kotlin 2\.0/u);
  assert.match(text, /Android Gradle Plugin: 8\.7/u);
});

function collectNodeText(value) {
  if (Array.isArray(value)) {
    return value.map(collectNodeText).join("\n");
  }
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return collectNodeText(value.children || []);
}
