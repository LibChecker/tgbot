import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebMcpTools,
  initWebMcp,
  summarizeReport,
} from "../src/app/webmcp.js";

test("WebMCP registers actionable and read-only tools with abort cleanup", async () => {
  const registrations = [];
  let pagehide;
  const documentRef = {
    modelContext: {
      async registerTool(tool, options) {
        registrations.push({ tool, options });
      },
    },
    defaultView: {
      addEventListener(type, listener, options) {
        assert.equal(type, "pagehide");
        assert.deepEqual(options, { once: true });
        pagehide = listener;
      },
    },
  };

  const registration = await initWebMcp({
    analyzeUrl: async () => createReport(),
    getCurrentReport: () => createReport(),
  }, { documentRef });

  assert.equal(registrations.length, 2);
  assert.deepEqual(registrations.map(({ tool }) => tool.name), [
    "analyze-android-package-url",
    "get-current-android-package-summary",
  ]);
  assert.equal(registrations[0].options.signal, registration.signal);
  assert.equal(registration.signal.aborted, false);
  pagehide();
  assert.equal(registration.signal.aborted, true);
});

test("WebMCP supports the navigator host used by current browser previews", async () => {
  const registrations = [];
  const navigatorRef = {
    modelContext: {
      async registerTool(tool) {
        registrations.push(tool.name);
      },
    },
  };

  await initWebMcp({
    analyzeUrl: async () => createReport(),
    getCurrentReport: () => createReport(),
  }, {
    documentRef: {},
    navigatorRef,
  });

  assert.deepEqual(registrations, [
    "analyze-android-package-url",
    "get-current-android-package-summary",
  ]);
});

test("WebMCP analyze tool returns a concise report summary", async () => {
  const tools = createWebMcpTools({
    analyzeUrl: async (url) => {
      assert.equal(url, "https://example.com/app.apk");
      return createReport();
    },
    getCurrentReport: () => null,
  });

  const result = await tools[0].execute({ url: "https://example.com/app.apk" });
  assert.deepEqual(result, summarizeReport(createReport()));
  assert.equal(result.packageName, "com.example.app");
  assert.equal(result.componentsCount, 4);
  assert.equal(result.sdkMarkersCount, 3);
});

test("WebMCP summary reports empty state without leaking undefined values", () => {
  assert.deepEqual(summarizeReport(null), {
    status: "empty",
    message: "No Android package report is currently available.",
  });
});

function createReport() {
  return {
    fileName: "app.apk",
    sourceUrl: "https://example.com/app.apk",
    analyzedAt: "2026-07-13T00:00:00.000Z",
    apkInfo: {
      appName: "Example",
      packageName: "com.example.app",
      versionName: "1.0",
      versionCode: 1,
      minSdk: 24,
      targetSdk: 36,
      permissions: ["android.permission.INTERNET"],
      nativeLibraries: ["libexample.so"],
      components: {
        activities: ["MainActivity"],
        services: ["SyncService"],
        receivers: ["BootReceiver"],
        providers: ["DataProvider"],
      },
      sdkSummary: {
        native: [{ label: "Native SDK" }],
        components: [{ label: "Component SDK 1" }, { label: "Component SDK 2" }],
      },
    },
  };
}
