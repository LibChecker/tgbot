import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBotReportDataUrl,
  normalizeBotReportPath,
  resolveBotReportUrlFromLocation,
} from "../src/app/bot-report-url.js";

test("short report query resolves through configured Worker origin", () => {
  const url = resolveBotReportUrlFromLocation(
    "?r=Island-Recorder-Report-Data-07-08-2&lang=zh-Hans",
    "https://worker.example.com",
    "en",
  );

  assert.equal(
    url,
    "https://worker.example.com/report-data?path=Island-Recorder-Report-Data-07-08-2&lang=zh-Hans",
  );
});

test("short report query requires a configured Worker origin", () => {
  assert.equal(
    resolveBotReportUrlFromLocation("?r=Island-Recorder-Report-Data-07-08-2&lang=zh-Hans", "", "en"),
    "",
  );
});

test("short report query rejects URL-shaped paths", () => {
  assert.equal(
    resolveBotReportUrlFromLocation(
      "?r=https%3A%2F%2Fworker.example.com%2Freport-data%3Fpath%3Dsample",
      "https://worker.example.com",
      "en",
    ),
    "",
  );
});

test("report data URL builder normalizes origin and locale", () => {
  assert.equal(
    buildBotReportDataUrl("https://worker.example.com/ignored/path", "Sample-07-08", ""),
    "https://worker.example.com/report-data?path=Sample-07-08&lang=en",
  );
});

test("report path normalization accepts only safe Telegraph path characters", () => {
  assert.equal(normalizeBotReportPath("Sample-07-08"), "Sample-07-08");
  assert.equal(normalizeBotReportPath("Sample/07/08"), "");
});
