import assert from "node:assert/strict";
import test from "node:test";

import app, { __botWorkerTestInternals } from "../src/index.js";

const {
  buildLinkReplyMarkup,
  buildWebUiReportUrl,
  buildMessageTelemetryFields,
  selectTargetDocument,
  selectTargetUrl,
} = __botWorkerTestInternals;

const apkDocument = {
  file_id: "apk-file",
  file_name: "sample.apk",
  mime_type: "application/vnd.android.package-archive",
};

test("private chats auto-analyze direct APK documents", () => {
  const message = {
    chat: { id: 1, type: "private" },
    document: apkDocument,
  };

  assert.equal(selectTargetDocument(message, null, false, false), apkDocument);
});

test("group chats ignore APK documents unless the bot is explicitly targeted", () => {
  const message = {
    chat: { id: -1, type: "supergroup" },
    document: apkDocument,
  };

  assert.equal(selectTargetDocument(message, null, false, false), null);
  assert.equal(selectTargetDocument(message, null, false, true), apkDocument);
  assert.equal(selectTargetDocument(message, "apkinfo", false, false), apkDocument);
});

test("group chats ignore APK links unless the bot is explicitly targeted", () => {
  const message = {
    chat: { id: -1, type: "group" },
    text: "https://example.com/sample.apk",
  };

  assert.equal(selectTargetUrl(message, null, false, false), null);
  assert.equal(selectTargetUrl(message, null, false, true), "https://example.com/sample.apk");
  assert.equal(selectTargetUrl(message, "apkinfo", false, false), "https://example.com/sample.apk");
});

test("private chats still auto-analyze direct APK links", () => {
  const message = {
    chat: { id: 1, type: "private" },
    text: "https://example.com/sample.apk",
  };

  assert.equal(selectTargetUrl(message, null, false, false), "https://example.com/sample.apk");
});

test("private chat report buttons use regular URLs", () => {
  const markup = buildLinkReplyMarkup(
    { id: 1, type: "private" },
    "https://example.com/?botReportUrl=https%3A%2F%2Fworker.example.com%2Freport-data%3Fpath%3Dsample",
    "Open report",
  );
  const button = markup.inline_keyboard[0][0];

  assert.equal(
    button.url,
    "https://example.com/?botReportUrl=https%3A%2F%2Fworker.example.com%2Freport-data%3Fpath%3Dsample",
  );
  assert.equal(button.web_app, undefined);
});

test("report URLs target the configured WebUI and pass the Worker report data endpoint", () => {
  const reportUrl = buildWebUiReportUrl(
    { WEBUI_SITE_URL: "https://webui.example.com/" },
    "https://worker.example.com",
    "Sample-07-08",
    "zh-Hans",
  );
  const url = new URL(reportUrl);
  const reportDataUrl = new URL(url.searchParams.get("botReportUrl"));

  assert.equal(url.origin, "https://webui.example.com");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("lang"), "zh-Hans");
  assert.equal(reportDataUrl.origin, "https://worker.example.com");
  assert.equal(reportDataUrl.pathname, "/report-data");
  assert.equal(reportDataUrl.searchParams.get("path"), "Sample-07-08");
  assert.equal(reportDataUrl.searchParams.get("lang"), "zh-Hans");
});

test("report data route handles CORS preflight through Hono middleware", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const response = await app.request("https://worker.example.com/report-data", {
      method: "OPTIONS",
      headers: {
        origin: "https://webui.example.com",
        "access-control-request-method": "GET",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("access-control-allow-methods") || "", /GET/u);
  } finally {
    console.log = originalLog;
  }
});

test("ignored group messages do not expose group identity in analytics telemetry", () => {
  const message = {
    message_id: 1,
    chat: {
      id: -1,
      type: "supergroup",
      title: "LibChecker Group",
      username: "libchecker_group",
    },
    text: "ordinary group chatter",
  };

  const fields = buildMessageTelemetryFields({ message }, message, null, false, "en");

  assert.equal(fields.chat_type, "supergroup");
  assert.equal(fields.chat_title, null);
  assert.equal(fields.chat_username, null);
});

test("targeted group messages still expose group identity in analytics telemetry", () => {
  const message = {
    message_id: 1,
    chat: {
      id: -1,
      type: "supergroup",
      title: "LibChecker Group",
      username: "libchecker_group",
    },
    text: "@LibCheckerRoBot https://example.com/sample.apk",
    entities: [{ type: "mention", offset: 0, length: 16 }],
  };

  const fields = buildMessageTelemetryFields({ message }, message, null, true, "en");

  assert.equal(fields.chat_title, "LibChecker Group");
  assert.equal(fields.chat_username, "@libchecker_group");
});
