import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBotReportDataUrl,
  normalizeBotReportRef,
  resolveBotReportUrlFromLocation,
} from "../src/app/bot-report-url.js";

const sampleRef = "rp_0123456789abcdef0123456789abcdef";

test("short report query resolves report refs through configured Worker origin", () => {
  const url = resolveBotReportUrlFromLocation(
    `?r=${sampleRef}&lang=zh-Hans`,
    "https://worker.example.com",
    "en",
  );

  assert.equal(
    url,
    `https://worker.example.com/report-data?ref=${sampleRef}&lang=zh-Hans`,
  );
});

test("short report query requires a configured Worker origin", () => {
  assert.equal(
    resolveBotReportUrlFromLocation(`?r=${sampleRef}&lang=zh-Hans`, "", "en"),
    "",
  );
});

test("short report query rejects non-R2 report refs", () => {
  assert.equal(
    resolveBotReportUrlFromLocation(
      "?r=https%3A%2F%2Fworker.example.com%2Freport-data%3Fpath%3Dsample",
      "https://worker.example.com",
      "en",
    ),
    "",
  );
  assert.equal(
    resolveBotReportUrlFromLocation(
      "?r=%E5%90%AF%E5%8A%A8%E9%81%AE%E7%BD%A9%E8%BF%9B%E5%8C%96-Report-Data-07-08&lang=zh-Hans",
      "https://worker.example.com",
      "en",
    ),
    "",
  );
});

test("report data URL builder normalizes origin and locale", () => {
  assert.equal(
    buildBotReportDataUrl("https://worker.example.com/ignored/path", sampleRef, ""),
    `https://worker.example.com/report-data?ref=${sampleRef}&lang=en`,
  );
});

test("report ref normalization accepts only generated R2 refs", () => {
  assert.equal(normalizeBotReportRef(sampleRef), sampleRef);
  assert.equal(normalizeBotReportRef("rp_0123456789abcdef0123456789abcdeg"), "");
  assert.equal(normalizeBotReportRef("Sample-07-08"), "");
  assert.equal(normalizeBotReportRef("启动遮罩进化-Report-Data-07-08"), "");
});
