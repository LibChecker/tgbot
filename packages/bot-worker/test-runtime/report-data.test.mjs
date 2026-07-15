import { env, exports } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import { createApkReportDataEntry, fetchReportData } from "../src/report-store.js";

afterEach(() => reset());

describe("report data runtime", () => {
  it("uses the preview bindings and persists reports in R2", async () => {
    expect(env.APP_ENV).toBe("preview");
    expect(env.REPORT_DATA_BUCKET).toBeDefined();
    expect(env.USAGE_ANALYTICS).toBeDefined();
    expect(env.CF_VERSION_METADATA).toBeDefined();

    const entry = await createApkReportDataEntry(env, createSampleReport());
    const object = await env.REPORT_DATA_BUCKET.get(`reports/v1/${entry.ref}.json`);
    const report = await fetchReportData(entry.ref, env);

    expect(entry.ref).toMatch(/^rp_[a-f0-9]{32}$/u);
    expect(object?.httpMetadata?.contentType).toBe("application/json; charset=UTF-8");
    expect(object?.customMetadata).toEqual({
      package_name: "com.example.runtime",
      schema_version: "1",
    });
    expect(report.apkInfo.packageName).toBe("com.example.runtime");
  });

  it("publishes and reads a report through the Worker fetch path", async () => {
    const publish = await exports.default.fetch(new Request("https://worker.example.com/report-data?lang=en", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://webui.example.com",
      },
      body: JSON.stringify({ locale: "en", report: createSampleReport() }),
    }));
    const published = await publish.json();

    expect(publish.status).toBe(200);
    expect(publish.headers.get("access-control-allow-origin")).toBe("https://webui.example.com");
    expect(published.url).toMatch(/^https:\/\/webui\.example\.com\/\?r=rp_/u);

    const read = await exports.default.fetch(new Request(
      `https://worker.example.com/report-data?ref=${published.ref}&lang=en`,
      { headers: { origin: "https://reader.example.com" } },
    ));
    expect(read.status).toBe(200);
    expect(read.headers.get("access-control-allow-origin")).toBe("*");
    expect((await read.json()).report.apkInfo.packageName).toBe("com.example.runtime");
  });

  it("rejects untrusted publish origins and oversized bodies", async () => {
    const forbidden = await exports.default.fetch(new Request("https://worker.example.com/report-data", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
      },
      body: "{}",
    }));
    expect(forbidden.status).toBe(403);

    const oversized = await exports.default.fetch(new Request("https://worker.example.com/report-data", {
      method: "POST",
      headers: {
        "content-length": String(4 * 1024 * 1024 + 1),
        "content-type": "application/json",
        origin: "https://webui.example.com",
      },
      body: "{}",
    }));
    expect(oversized.status).toBe(413);
  });
});

function createSampleReport() {
  return {
    locale: "en",
    fileName: "runtime.apk",
    fileSizeBytes: 2048,
    fileSizeText: "2 KB",
    sourceLabel: "Runtime Test",
    analyzedAt: "2026-07-15T00:00:00.000Z",
    featureIcons: {
      compose: "",
      gradle: "",
      kotlin: "",
    },
    apkInfo: {
      appName: "Runtime",
      packageName: "com.example.runtime",
      versionName: "1.0",
      versionCode: "1",
      minSdk: "23",
      targetSdk: "35",
      compileSdk: "35",
      icon: null,
      permissions: [],
      nativeLibraries: [],
      components: {
        activities: [],
        services: [],
        receivers: [],
        providers: [],
      },
      metaData: { application: [], components: [] },
      buildFeatures: {
        kotlinDetected: false,
        kotlinVersion: null,
        composeDetected: false,
        composeVersion: null,
        gradleVersion: null,
        agpVersion: null,
        appMetadataVersion: null,
      },
      signatures: { certificates: [], schemes: [] },
      sdkSummary: { native: [], components: [] },
    },
  };
}
