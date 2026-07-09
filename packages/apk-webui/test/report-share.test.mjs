import assert from "node:assert/strict";
import test from "node:test";

import { publishReport } from "../src/app/report-share.js";

test("report sharing strips hydrated SDK rule details before publishing", async () => {
  const report = createReportWithHydratedRuleDetails();
  const rawBodyBytes = new TextEncoder()
    .encode(JSON.stringify({ report, locale: "zh-Hans" }))
    .byteLength;
  let capturedRequest;

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint, init) => {
    capturedRequest = { endpoint, init };
    return new Response(JSON.stringify({
      url: "https://web.example/?r=rp_0123456789abcdef0123456789abcdef&lang=zh-Hans",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const payload = await publishReport({
      endpoint: "https://worker.example/report-data?lang=zh-Hans",
      report,
      locale: "zh-Hans",
    });

    assert.equal(
      payload.url,
      "https://web.example/?r=rp_0123456789abcdef0123456789abcdef&lang=zh-Hans",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }

  const publishedBodyBytes = new TextEncoder()
    .encode(capturedRequest.init.body)
    .byteLength;
  const publishedPayload = JSON.parse(capturedRequest.init.body);

  assert.equal(capturedRequest.endpoint, "https://worker.example/report-data?lang=zh-Hans");
  assert.equal(capturedRequest.init.method, "POST");
  assert.equal(publishedPayload.report.apkInfo.sdkSummary.native[0].ruleDetail, null);
  assert.equal(publishedPayload.report.apkInfo.sdkSummary.components[0].ruleDetail, null);
  assert.equal(publishedPayload.report.apkInfo.nativeLibraries[0].sdk.ruleDetail, null);
  assert.equal(publishedPayload.report.apkInfo.components.activities[0].sdk.ruleDetail, null);
  assert.equal(report.apkInfo.sdkSummary.native[0].ruleDetail.locales.en.description.length, 1024 * 1024);
  assert.ok(rawBodyBytes > 4 * 1024 * 1024);
  assert.ok(publishedBodyBytes < 4 * 1024 * 1024);
});

function createReportWithHydratedRuleDetails() {
  const ruleDetail = (label) => ({
    locales: {
      en: {
        label,
        description: "x".repeat(1024 * 1024),
      },
    },
  });

  return {
    locale: "en",
    fileName: "sample.apk",
    fileSizeBytes: 2048,
    analyzedAt: "2026-07-08T00:00:00.000Z",
    apkInfo: {
      appName: "Sample",
      packageName: "com.example.sample",
      nativeLibraries: [
        {
          abi: "arm64-v8a",
          name: "libsample.so",
          path: "lib/arm64-v8a/libsample.so",
          sdk: {
            key: "native-sample",
            label: "Native SDK",
            ruleDetail: ruleDetail("Native SDK"),
          },
        },
      ],
      components: {
        activities: [
          {
            name: "com.example.MainActivity",
            sdk: {
              key: "component-sample",
              label: "Component SDK",
              ruleDetail: ruleDetail("Component SDK"),
            },
          },
        ],
        services: [],
        receivers: [],
        providers: [],
      },
      sdkSummary: {
        native: [
          {
            key: "native-summary",
            label: "Native Summary",
            ruleDetail: ruleDetail("Native Summary"),
          },
        ],
        components: [
          {
            key: "component-summary",
            label: "Component Summary",
            ruleDetail: ruleDetail("Component Summary"),
          },
        ],
      },
    },
  };
}
