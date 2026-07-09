import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, mergeConfig } from "vite";

import viteConfig from "../vite.config.mjs";

let viteServer;
let reportRenderer;

before(async () => {
  viteServer = await createServer(mergeConfig(viteConfig, {
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  }));
  reportRenderer = await viteServer.ssrLoadModule("/app/report-renderer.js");
});

after(async () => {
  await viteServer?.close();
});

test("report renderer caps long permission lists", () => {
  setupRenderer("permissions");
  const permissions = Array.from({ length: reportRenderer.REPORT_LIST_RENDER_LIMIT + 3 }, (_, index) => (
    `com.example.PERMISSION_${String(index).padStart(3, "0")}`
  ));
  const html = reportRenderer.renderTabPanelHtml(createReport({ permissions }));

  assert.equal(count(html, "permission-table-row"), reportRenderer.REPORT_LIST_RENDER_LIMIT);
  assert.match(html, /3 more items hidden/);
  assert.match(html, /PERMISSION_000/);
  assert.doesNotMatch(html, /PERMISSION_122/);
});

test("report renderer caps long component groups", () => {
  setupRenderer("components");
  const activities = Array.from({ length: reportRenderer.REPORT_LIST_RENDER_LIMIT + 2 }, (_, index) => ({
    name: `com.example.Activity${String(index).padStart(3, "0")}`,
  }));
  const html = reportRenderer.renderTabPanelHtml(createReport({
    components: { activities },
  }));

  assert.equal(count(html, `<article class="list-row component-row">`), reportRenderer.REPORT_LIST_RENDER_LIMIT);
  assert.match(html, /2 more items hidden/);
  assert.match(html, /Activity000/);
  assert.doesNotMatch(html, /Activity121/);
});

test("report renderer caps long native library groups", () => {
  setupRenderer("native");
  const nativeLibraries = Array.from({ length: reportRenderer.REPORT_LIST_RENDER_LIMIT + 4 }, (_, index) => ({
    abi: "arm64-v8a",
    name: `libsample${String(index).padStart(3, "0")}.so`,
    size: 4096,
  }));
  const html = reportRenderer.renderTabPanelHtml(createReport({ nativeLibraries }));

  assert.equal(count(html, `<article class="list-row native-library-row">`), reportRenderer.REPORT_LIST_RENDER_LIMIT);
  assert.match(html, /4 more items hidden/);
  assert.match(html, /libsample000\.so/);
  assert.doesNotMatch(html, /libsample123\.so/);
});

function setupRenderer(activeTab) {
  reportRenderer.configureReportRenderer({
    runtime: {
      sdkIconRendererModule: {
        renderSdkChip: () => "",
        renderSdkIcon: () => "",
        renderSdkInline: () => "",
        renderSdkRuleLabel: (sdk, unknownLabel) => sdk?.label || unknownLabel,
      },
    },
    state: {
      activeTab,
      activeNativeAbi: "",
      locale: "en",
    },
    t,
    formatDate: (value) => String(value || ""),
    trackWebEvent: () => {},
    getReportAnalyticsFields: () => ({}),
  });
}

function createReport(apkInfo = {}) {
  const components = {
    activities: [],
    services: [],
    receivers: [],
    providers: [],
    ...(apkInfo.components || {}),
  };

  return {
    fileName: "sample.apk",
    fileSizeBytes: 4096,
    analyzedAt: "2026-07-09T00:00:00.000Z",
    durationMs: 10,
    apkInfo: {
      appName: "Sample",
      packageName: "com.example.sample",
      versionName: "1.0",
      versionCode: 1,
      targetSdk: 35,
      minSdk: 23,
      compileSdk: 35,
      buildFeatures: {},
      components,
      metaData: { application: [] },
      nativeLibraries: [],
      permissions: [],
      sdkSummary: { native: [], components: [] },
      signatures: { schemes: [], certificates: [] },
      ...apkInfo,
      components,
    },
  };
}

function t(key, variables = {}) {
  if (key === "compareMoreItems") {
    return `${variables.count} more items hidden`;
  }
  return LABELS[key] || key;
}

function count(value, needle) {
  return value.split(needle).length - 1;
}

const LABELS = {
  abi: "ABI",
  activities: "Activities",
  analyzedAt: "Analyzed At",
  appName: "App Name",
  buildFeatures: "Build Features",
  compileSdk: "Compile SDK",
  completedIn: `${0.01.toFixed(2)}s`,
  components: "Components",
  duration: "Duration",
  fileName: "File Name",
  fileSize: "File Size",
  metaData: "Meta-Data",
  minSdk: "Min SDK",
  nativeLibraries: "Native Libraries",
  noComponents: "No components",
  noNativeLibraries: "No native libraries",
  noPermissions: "No permissions",
  packageName: "Package Name",
  permissions: "Permissions",
  providers: "Providers",
  receivers: "Receivers",
  resource: "Resource",
  services: "Services",
  signatures: "Signatures",
  size: "Size",
  source: "Source",
  targetSdk: "Target SDK",
  terminalSystem: "Terminal System",
  unknown: "Unknown",
  versionCode: "Version Code",
  versionName: "Version Name",
};
