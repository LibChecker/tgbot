import assert from "node:assert/strict";
import test from "node:test";

import app, { __botWorkerTestInternals } from "../src/index.js";

const {
  buildLinkReplyMarkup,
  buildWebUiReportUrl,
  formatSdkMarkerSummary,
  stripTelegramCustomEmojiTags,
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
    "https://example.com/?r=sample&lang=en",
    "Open report",
  );
  const button = markup.inline_keyboard[0][0];

  assert.equal(
    button.url,
    "https://example.com/?r=sample&lang=en",
  );
  assert.equal(button.web_app, undefined);
});

const sampleReportRef = "rp_0123456789abcdef0123456789abcdef";

test("report URLs target the configured WebUI with a short report ref", () => {
  const reportUrl = buildWebUiReportUrl(
    { WEBUI_SITE_URL: "https://webui.example.com/" },
    "https://worker.example.com",
    sampleReportRef,
    "zh-Hans",
  );
  const url = new URL(reportUrl);

  assert.equal(url.origin, "https://webui.example.com");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("r"), sampleReportRef);
  assert.equal(url.searchParams.get("lang"), "zh-Hans");
  assert.deepEqual(Array.from(url.searchParams.keys()), ["r", "lang"]);
});

test("report URLs fall back to Worker report data when WebUI is not configured", () => {
  const reportUrl = buildWebUiReportUrl(
    {},
    "https://worker.example.com",
    sampleReportRef,
    "zh-Hans",
  );
  const url = new URL(reportUrl);

  assert.equal(url.origin, "https://worker.example.com");
  assert.equal(url.pathname, "/report-data");
  assert.equal(url.searchParams.get("ref"), sampleReportRef);
  assert.equal(url.searchParams.get("lang"), "zh-Hans");
});

test("SDK marker summary lists bounded markers with icons and overflow", () => {
  const summary = formatSdkMarkerSummary({
    native: [
      { key: "android", label: "Android", iconName: "ic_lib_android", count: 2 },
      { key: "react", label: "React Native", iconName: "ic_test_react", count: 1 },
      { key: "firebase", label: "Firebase", iconName: "ic_test_firebase", count: 8 },
      { key: "adjust", label: "Adjust", iconName: "ic_test_adjust", count: 7 },
      { key: "bugly", label: "Bugly", iconName: "ic_test_bugly", count: 6 },
      { key: "facebook", label: "Facebook", iconName: "ic_test_facebook", count: 5 },
      { key: "flurry", label: "Flurry", iconName: "ic_test_flurry", count: 4 },
      { key: "unity", label: "Unity", iconName: "ic_test_unity", count: 3 },
      { key: "x5", label: "X5", iconName: "ic_test_x5", count: 2 },
    ],
    components: [
      { key: "android", label: "Android", iconName: "ic_lib_android", count: 3 },
    ],
  }, (key, values = {}) => {
    if (key === "summary.sdk_summary_native") {
      return `Native ${values.count}`;
    }
    if (key === "summary.sdk_summary_components") {
      return `Components ${values.count}`;
    }
    if (key === "summary.sdk_summary_more") {
      return `+${values.count} more`;
    }
    return key;
  }, { ic_lib_android: "123456" });

  assert.equal(summary, [
    "Native 9 · Components 1",
    "<code>Firebase</code> <b>x8</b>",
    "<code>Adjust</code> <b>x7</b>",
    "<code>Bugly</code> <b>x6</b>",
    "<tg-emoji emoji-id=\"123456\">🔹</tg-emoji> <code>Android</code> <b>x5</b>",
    "<code>Facebook</code> <b>x5</b>",
    "<code>Flurry</code> <b>x4</b>",
    "<code>Unity</code> <b>x3</b>",
    "<code>X5</code> <b>x2</b>",
    "+1 more",
  ].join("\n"));
});

test("report data route handles CORS preflight through Hono middleware", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const response = await app.request("https://worker.example.com/report-data", {
      method: "OPTIONS",
      headers: {
        origin: "https://webui.example.com",
        "access-control-request-method": "POST",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("access-control-allow-methods") || "", /GET/u);
    assert.match(response.headers.get("access-control-allow-methods") || "", /POST/u);
  } finally {
    console.log = originalLog;
  }
});

test("report data route treats missing R2 binding as server configuration error", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    const response = await app.request(`https://worker.example.com/report-data?ref=${sampleReportRef}&lang=en`);
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error.message, "Report storage is not configured.");
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
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

test("custom emoji fallback keeps the readable SDK summary text", () => {
  assert.equal(
    stripTelegramCustomEmojiTags('<tg-emoji emoji-id="123456">🔹</tg-emoji> <code>Android</code>'),
    '🔹 <code>Android</code>',
  );
});
