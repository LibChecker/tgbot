import assert from "node:assert/strict";
import test from "node:test";

import { persistHistory, readHistory } from "../src/app/history.js";

const HISTORY_STORAGE_KEY = "apk-webui-history";

test("migrates legacy localStorage history during an idle callback", () => {
  const writes = [];
  let idleCallback = null;
  globalThis.window = {
    crypto: { randomUUID: () => "generated-id" },
    localStorage: {
      getItem(key) {
        assert.equal(key, HISTORY_STORAGE_KEY);
        return JSON.stringify([createHistoryEntry({ compactVersion: 0, summary: null })]);
      },
      setItem(key, value) {
        writes.push([key, value]);
      },
    },
    requestIdleCallback(callback) {
      idleCallback = callback;
      return 1;
    },
  };

  const history = readHistory();

  assert.equal(history.length, 1);
  assert.equal(history[0].compactVersion, 1);
  assert.equal(typeof idleCallback, "function");
  idleCallback();
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0][1])[0].compactVersion, 1);
  delete globalThis.window;
});

test("falls back to compact history when a storage quota write fails", () => {
  const writes = [];
  globalThis.window = {
    crypto: { randomUUID: () => "generated-id" },
    localStorage: {
      setItem(_key, value) {
        writes.push(value);
        if (value.includes("oversized-rule-detail")) {
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        }
      },
    },
  };

  const history = persistHistory([
    createHistoryEntry({
      compactVersion: 1,
      summary: {
        appName: "Example",
        packageName: "com.example.app",
        fileName: "example.apk",
      },
      report: {
        ...createReport(),
        apkInfo: {
          ...createReport().apkInfo,
          sdkSummary: {
            native: [{ ruleDetail: "oversized-rule-detail" }],
            components: [],
          },
        },
      },
    }),
  ]);

  assert.equal(writes.length, 2);
  assert.equal(history[0].report.apkInfo.sdkSummary.native[0].ruleDetail, undefined);
  delete globalThis.window;
});

test("returns an empty history when localStorage access fails", () => {
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    },
  };

  assert.deepEqual(readHistory(), []);
  delete globalThis.window;
});

function createHistoryEntry(overrides = {}) {
  return {
    id: "history-id",
    key: "com.example.app::1::example.apk::123",
    savedAt: "2026-07-15T00:00:00.000Z",
    compactVersion: 1,
    summary: {
      appName: "Example",
      packageName: "com.example.app",
      fileName: "example.apk",
    },
    report: createReport(),
    ...overrides,
  };
}

function createReport() {
  return {
    fileName: "example.apk",
    fileSizeBytes: 123,
    analyzedAt: "2026-07-15T00:00:00.000Z",
    apkInfo: {
      appName: "Example",
      packageName: "com.example.app",
      versionName: "1.0",
      versionCode: "1",
      targetSdk: "35",
      permissions: [],
      nativeLibraries: [],
      components: {
        activities: [],
        services: [],
        receivers: [],
        providers: [],
      },
      sdkSummary: {
        native: [],
        components: [],
      },
    },
  };
}
