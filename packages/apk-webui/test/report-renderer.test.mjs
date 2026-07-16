import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, mergeConfig } from "vite";

import viteConfig from "../vite.config.mjs";

let viteServer;
let i18n;
let reportRenderer;
let elfDetailModal;

before(async () => {
  viteServer = await createServer(mergeConfig(viteConfig, {
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  }));
  i18n = await viteServer.ssrLoadModule("/app/i18n.js");
  await Promise.all(["en", "ja", "ko", "zh-Hans", "zh-Hant"].map((locale) => i18n.loadLocale(locale)));
  reportRenderer = await viteServer.ssrLoadModule("/app/report-renderer.js");
  elfDetailModal = await viteServer.ssrLoadModule("/app/elf-detail-modal.js");
});

after(async () => {
  await viteServer?.close();
});

test("report version labels use semantic localized names", () => {
  assert.equal(i18n.translate("en", "versionName"), "Version Name");
  assert.equal(i18n.translate("en", "versionCode"), "Version Code");
  assert.equal(i18n.translate("ja", "versionName"), "バージョン名");
  assert.equal(i18n.translate("ja", "versionCode"), "バージョンコード");
  assert.equal(i18n.translate("ko", "versionName"), "버전 이름");
  assert.equal(i18n.translate("ko", "versionCode"), "버전 코드");
  assert.equal(i18n.translate("zh-Hans", "versionName"), "版本名称");
  assert.equal(i18n.translate("zh-Hans", "versionCode"), "版本号");
  assert.equal(i18n.translate("zh-Hant", "versionName"), "版本名稱");
  assert.equal(i18n.translate("zh-Hant", "versionCode"), "版本代碼");
});

test("native SDK summary details follow the active locale", () => {
  const report = createReport({
    sdkSummary: {
      native: [{
        label: "Sample SDK",
        count: 1,
        fileCount: 4,
        abis: ["arm64-v8a", "x86_64"],
        detail: "1 library name · 4 files · ABI arm64-v8a, x86_64",
        previewItems: ["libsample.so"],
      }],
      components: [],
    },
  });

  setupRenderer("sdk", {}, {
    locale: "en",
    translate: (key, variables) => i18n.translate("en", key, variables),
  });
  const englishHtml = reportRenderer.renderTabPanelHtml(report);
  assert.match(englishHtml, /1 library name · 4 files · ABI arm64-v8a, x86_64/);
  assert.doesNotMatch(englishHtml, /个库名|个文件/);

  setupRenderer("sdk", {}, {
    locale: "zh-Hans",
    translate: (key, variables) => i18n.translate("zh-Hans", key, variables),
  });
  const chineseHtml = reportRenderer.renderTabPanelHtml(report);
  assert.match(chineseHtml, /1 个库名 · 4 个文件 · ABI arm64-v8a, x86_64/);
});

test("native SDK summary localizes legacy stored detail text", () => {
  const report = createReport({
    sdkSummary: {
      native: [{
        label: "Legacy SDK",
        count: 1,
        detail: "1 个库名 · 4 个文件 · ABI arm64-v8a, x86_64",
        previewItems: [],
      }],
      components: [],
    },
  });

  setupRenderer("sdk", {}, {
    locale: "en",
    translate: (key, variables) => i18n.translate("en", key, variables),
  });
  const html = reportRenderer.renderTabPanelHtml(report);
  assert.match(html, /1 library name · 4 files · ABI arm64-v8a, x86_64/);
  assert.doesNotMatch(html, /个库名|个文件/);
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

test("report renderer separates and escapes component package and simple name", () => {
  setupRenderer("components");
  const html = reportRenderer.renderTabPanelHtml(createReport({
    components: {
      activities: [
        { name: "top.yukonga.mishka.MainActivity" },
        { name: "StandaloneActivity" },
        { name: "com.example.<UnsafeActivity>" },
      ],
    },
  }));

  assert.match(html, /<span class="component-name-prefix">top\.yukonga\.mishka\.<\/span>/);
  assert.match(html, /<span class="component-name-simple">MainActivity<\/span>/);
  assert.match(html, /<span class="component-name-simple">StandaloneActivity<\/span>/);
  assert.match(html, /<span class="component-name-simple">&lt;UnsafeActivity&gt;<\/span>/);
  assert.doesNotMatch(html, /<UnsafeActivity>/);
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

test("native library rows expose accessible ELF detail controls", () => {
  setupRenderer("native");
  const html = reportRenderer.renderTabPanelHtml(createReport({
    nativeLibraries: [{
      abi: "arm64-v8a",
      name: "libsample.so",
      path: "lib/arm64-v8a/libsample.so",
      sourceEntry: "base.apk",
      size: 4096,
    }],
  }));

  assert.equal(count(html, "data-elf-details"), 1);
  assert.match(html, /data-library-path="lib\/arm64-v8a\/libsample\.so"/u);
  assert.match(html, /data-library-source-entry="base\.apk"/u);
  assert.match(html, /aria-label="View ELF details for libsample\.so"/u);
  assert.match(html, /<circle cx="12" cy="12" r="2\.7"><\/circle>/u);
});

test("ELF detail content renders all inspection groups and escapes parsed data", () => {
  const translate = (key, variables) => i18n.translate("en", key, variables);
  const html = elfDetailModal.renderElfDetailContent({
    library: {
      abi: "arm64-v8a",
      name: "libsample.so",
      size: 4096,
      elfPageSize: 16384,
      zipAlignment: 4096,
    },
    details: {
      byteLength: 4096,
      header: { class: "ELF64", type: "ET_DYN", machine: "AArch64" },
      programHeaders: [{
        index: 0,
        type: "PT_LOAD",
        flags: "R-E",
        offset: "0x0",
        virtualAddress: "0x1000",
        physicalAddress: "0x1000",
        fileSize: "0x1000",
        memorySize: "0x1000",
        alignment: "0x4000",
      }],
      sectionHeaders: [{
        index: 1,
        name: "<img src=x onerror=alert(1)>",
        type: "SHT_DYNSYM",
      }],
      dynamic: {
        needed: ["libc.so"],
        entries: [{ index: 0, section: ".dynamic", tag: "DT_NEEDED", value: "0x1", text: "libc.so" }],
      },
      symbols: [{
        table: ".dynsym",
        index: 1,
        name: "smoke_symbol",
        type: "FUNC",
      }],
      notes: [{
        section: ".note.gnu.build-id",
        owner: "GNU",
        type: "NT_GNU_BUILD_ID",
        description: "0102",
        descriptionSize: 2,
      }],
      counts: { programHeaders: 1, sectionHeaders: 1, dynamicEntries: 1, symbols: 1, notes: 1 },
      truncated: {},
    },
    t: translate,
  });

  for (const heading of ["ELF Header", "Program Headers", "Section Headers", "Dynamic Linking", "Symbols", "Notes"]) {
    assert.match(html, new RegExp(heading, "u"));
  }
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, />16 KB</u);
  assert.match(html, /<dt>ZIPALIGN<\/dt><dd class="app-data-text">4 KB<\/dd>/u);
  assert.doesNotMatch(html, /16\.00 KB/u);
  const dialog = {};
  assert.equal(elfDetailModal.shouldCloseElfDetailModalOnBackdropClick({ target: dialog }, dialog, true), true);
  assert.equal(elfDetailModal.shouldCloseElfDetailModalOnBackdropClick({ target: {} }, dialog, true), false);
  assert.equal(elfDetailModal.parseCssTimeMs("150ms", 1), 150);
  assert.equal(elfDetailModal.parseCssTimeMs("0.25s", 1), 250);
  assert.equal(elfDetailModal.parseCssTimeMs("invalid", 150), 150);
});

test("ELF detail content distinguishes compressed and unknown ZIP alignment", () => {
  const translate = (key, variables) => i18n.translate("en", key, variables);
  const details = {
    byteLength: 4096,
    header: { class: "ELF64" },
  };
  const compressedHtml = elfDetailModal.renderElfDetailContent({
    library: {
      abi: "arm64-v8a",
      name: "libcompressed.so",
      size: 4096,
      zipCompression: "deflate",
    },
    details,
    t: translate,
  });
  const unknownHtml = elfDetailModal.renderElfDetailContent({
    library: {
      abi: "arm64-v8a",
      name: "libunknown.so",
      size: 4096,
      zipCompression: "store",
    },
    details,
    t: translate,
  });

  assert.match(compressedHtml, /<dt>ZIPALIGN<\/dt><dd class="app-data-text">Compressed \/ not applicable<\/dd>/u);
  assert.match(unknownHtml, /<dt>ZIPALIGN<\/dt><dd class="app-data-text">Unknown<\/dd>/u);
});

test("report renderer adds build feature icons and hides app metadata", () => {
  setupRenderer("summary", {
    renderSdkIcon: (src, label, singleColorIcon = false) => src
      ? `<i class="feature-icon-test" data-label="${label}" data-src="${src}" data-mono="${String(singleColorIcon)}">${label}</i>`
      : "",
  });
  const report = createReport({
    buildFeatures: {
      kotlinDetected: true,
      kotlinVersion: "2.0",
      agpVersion: "8.7",
      appMetadataVersion: "1.0",
    },
  });
  report.featureIcons = {
    kotlin: "data:image/svg+xml;charset=UTF-8,kotlin",
    gradle: "data:image/svg+xml;charset=UTF-8,gradle",
  };
  const html = reportRenderer.renderTabPanelHtml(report);

  assert.match(html, /feature-icon-test/);
  assert.match(html, /Kotlin 2\.0/);
  assert.match(html, /data-label="AGP" data-src="data:image\/svg\+xml;charset=UTF-8,gradle" data-mono="true"/);
  assert.doesNotMatch(html, /App Metadata/);
});

test("report renderer shows download URL below file name", () => {
  setupRenderer("summary");
  const report = createReport();
  report.sourceUrl = "https://example.com/app.apk?channel=stable";
  const html = reportRenderer.renderTabPanelHtml(report);

  assert.match(html, /File Name[\s\S]*sample\.apk[\s\S]*Download Link[\s\S]*https:\/\/example\.com\/app\.apk\?channel=stable[\s\S]*File Size/);
});

test("report hero labels only local reports as local files", () => {
  setupRenderer("summary");
  const localReport = createReport();
  assert.match(reportRenderer.renderHero(localReport), /Local file/);

  const urlReport = createReport();
  urlReport.sourceUrl = "https://example.com/app.apk";
  assert.doesNotMatch(reportRenderer.renderHero(urlReport), /Local file/);

  const legacyUrlReport = createReport();
  legacyUrlReport.terminalSystem = { name: "Cloudflare Pages", version: "", source: "webui-link" };
  assert.doesNotMatch(reportRenderer.renderHero(legacyUrlReport), /Local file/);
});

function setupRenderer(activeTab, sdkIconRendererOverrides = {}, localization = {}) {
  reportRenderer.configureReportRenderer({
    runtime: {
      sdkIconRendererModule: {
        renderSdkChip: () => "",
        renderSdkIcon: () => "",
        renderSdkInline: () => "",
        renderSdkRuleLabel: (sdk, unknownLabel) => sdk?.label || unknownLabel,
        ...sdkIconRendererOverrides,
      },
    },
    state: {
      activeTab,
      activeNativeAbi: "",
      locale: localization.locale || "en",
    },
    t: localization.translate || t,
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
  if (key === "elfDetailsButton") {
    return `View ELF details for ${variables.name}`;
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
  downloadUrl: "Download Link",
  fileSize: "File Size",
  metaData: "Meta-Data",
  localFile: "Local file",
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
