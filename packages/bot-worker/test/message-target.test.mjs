import assert from "node:assert/strict";
import test from "node:test";

import app, { __botWorkerTestInternals } from "../src/index.js";

const {
  buildLinkReplyMarkup,
  buildWebUiReportUrl,
  formatFeatureChipsHtml,
  formatSdkMarkerSummary,
  getManagedCommandLanguageCodes,
  stripTelegramCustomEmojiTags,
  buildMessageTelemetryFields,
  selectTargetDocument,
  selectTargetUrl,
  shouldUseWebUiUploadGuide,
} = __botWorkerTestInternals;

test("managed bot commands use unique two-letter Telegram language codes", () => {
  assert.deepEqual(
    getManagedCommandLanguageCodes(["en", "ja", "ko", "zh-Hans", "zh-Hant", "fil"], "en"),
    ["ja", "ko", "zh"],
  );
});

const apkDocument = {
  file_id: "apk-file",
  file_name: "sample.apk",
  mime_type: "application/vnd.android.package-archive",
};

test("private chats select direct APK documents for handling", () => {
  const message = {
    chat: { id: 1, type: "private" },
    document: apkDocument,
  };

  assert.equal(selectTargetDocument(message, null, false, false), apkDocument);
});

test("Telegram APK documents up to the Bot API limit stay on bot analysis", () => {
  const telegramBotApiLimitBytes = 20 * 1024 * 1024;

  assert.equal(
    shouldUseWebUiUploadGuide({ ...apkDocument, file_size: telegramBotApiLimitBytes }),
    false,
  );
  assert.equal(
    shouldUseWebUiUploadGuide({ ...apkDocument, file_size: 1 }),
    false,
  );
  assert.equal(
    shouldUseWebUiUploadGuide({ ...apkDocument }),
    false,
  );
});

test("Telegram APK documents over the Bot API limit use WebUI upload guidance", () => {
  const telegramBotApiLimitBytes = 20 * 1024 * 1024;

  assert.equal(
    shouldUseWebUiUploadGuide({ ...apkDocument, file_size: telegramBotApiLimitBytes + 1 }),
    true,
  );
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

test("report URLs preserve the configured Pages preview URL", () => {
  const reportUrl = buildWebUiReportUrl(
    { WEBUI_SITE_URL: "https://codex-share.tgbot-apk-webui.pages.dev/" },
    "https://worker.example.com",
    sampleReportRef,
    "en",
  );
  const url = new URL(reportUrl);

  assert.equal(url.origin, "https://codex-share.tgbot-apk-webui.pages.dev");
  assert.equal(url.searchParams.get("r"), sampleReportRef);
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

test("upload route redirects to the configured WebUI upload entry", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const response = await app.request("https://worker.example.com/upload?lang=zh-Hans", {
      method: "POST",
    }, {
      WEBUI_SITE_URL: "https://webui.example.com/",
    });
    const url = new URL(response.headers.get("location"));

    assert.equal(response.status, 303);
    assert.equal(url.origin, "https://webui.example.com");
    assert.equal(url.pathname, "/");
    assert.equal(url.searchParams.get("lang"), "zh-Hans");
  } finally {
    console.log = originalLog;
  }
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

test("build feature summary uses canonical custom emoji icons", () => {
  assert.equal(
    formatFeatureChipsHtml({
      kotlinDetected: true,
      kotlinVersion: "2.1.0",
      composeDetected: true,
      composeVersion: "1.8.0",
      gradleVersion: "8.13",
      agpVersion: "8.8.0",
    }, {
      ic_lib_kotlin: "101",
      ic_lib_jetpack_compose: "102",
      ic_gradle: "103",
    }),
    [
      '<tg-emoji emoji-id="101">🟣</tg-emoji> <code>Kotlin 2.1.0</code>',
      '<tg-emoji emoji-id="102">🎨</tg-emoji> <code>Compose 1.8.0</code>',
      '<tg-emoji emoji-id="103">🟢</tg-emoji> <code>Gradle 8.13</code>',
      '<tg-emoji emoji-id="103">🧱</tg-emoji> <code>AGP 8.8.0</code>',
    ].join(" "),
  );
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
    }, {
      WEBUI_SITE_URL: "https://webui.example.com/",
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://webui.example.com");
    assert.match(response.headers.get("access-control-allow-methods") || "", /POST/u);
  } finally {
    console.log = originalLog;
  }
});

test("report data route allows CORS preflight from other Pages preview subdomains", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const response = await app.request("https://worker.example.com/report-data", {
      method: "OPTIONS",
      headers: {
        origin: "https://feature.tgbot-apk-webui.pages.dev",
        "access-control-request-method": "POST",
      },
    }, {
      WEBUI_SITE_URL: "https://codex-share.tgbot-apk-webui.pages.dev/",
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://feature.tgbot-apk-webui.pages.dev");
  } finally {
    console.log = originalLog;
  }
});

test("report data route publishes reports from the configured WebUI origin", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const bucket = createMemoryBucket();
    const response = await app.request("https://worker.example.com/report-data?lang=zh-Hans", {
      method: "POST",
      headers: {
        origin: "https://webui.example.com",
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        locale: "zh-Hans",
        report: createSampleReport(),
      }),
    }, {
      REPORT_DATA_BUCKET: bucket,
      WEBUI_SITE_URL: "https://webui.example.com/",
    });
    const body = await response.json();
    const url = new URL(body.url);

    assert.equal(response.status, 200);
    assert.match(body.ref, /^rp_[a-f0-9]{32}$/u);
    assert.equal(url.origin, "https://webui.example.com");
    assert.equal(url.searchParams.get("r"), body.ref);
    assert.equal(url.searchParams.get("lang"), "zh-Hans");
    assert.equal(bucket.objects.size, 1);
  } finally {
    console.log = originalLog;
  }
});

test("report data route accepts different Pages preview origins for the same project", async () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const bucket = createMemoryBucket();
    const response = await app.request("https://worker.example.com/report-data?lang=en", {
      method: "POST",
      headers: {
        origin: "https://feature.tgbot-apk-webui.pages.dev",
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        locale: "en",
        report: createSampleReport(),
      }),
    }, {
      REPORT_DATA_BUCKET: bucket,
      WEBUI_SITE_URL: "https://codex-share.tgbot-apk-webui.pages.dev/",
    });
    const body = await response.json();
    const url = new URL(body.url);

    assert.equal(response.status, 200);
    assert.equal(url.origin, "https://codex-share.tgbot-apk-webui.pages.dev");
    assert.equal(url.searchParams.get("r"), body.ref);
    assert.equal(bucket.objects.size, 1);
  } finally {
    console.log = originalLog;
  }
});

test("report data route rejects publishes from untrusted origins", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    const bucket = createMemoryBucket();
    const response = await app.request("https://worker.example.com/report-data?lang=en", {
      method: "POST",
      headers: {
        origin: "https://attacker.example.com",
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        report: createSampleReport(),
      }),
    }, {
      REPORT_DATA_BUCKET: bucket,
      WEBUI_SITE_URL: "https://webui.example.com/",
    });

    assert.equal(response.status, 403);

    const oversizedResponse = await app.request("https://worker.example.com/report-data?lang=en", {
      method: "POST",
      headers: {
        origin: "https://attacker.example.com",
        "content-type": "application/json; charset=UTF-8",
        "content-length": String(5 * 1024 * 1024),
      },
      body: "{}",
    }, {
      REPORT_DATA_BUCKET: bucket,
      WEBUI_SITE_URL: "https://webui.example.com/",
    });

    assert.equal(oversizedResponse.status, 403);
    assert.equal(bucket.objects.size, 0);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
});

test("report data route rejects oversized publish bodies", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    const response = await app.request("https://worker.example.com/report-data?lang=en", {
      method: "POST",
      headers: {
        origin: "https://webui.example.com",
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        report: "x".repeat(4 * 1024 * 1024),
      }),
    }, {
      REPORT_DATA_BUCKET: createMemoryBucket(),
      WEBUI_SITE_URL: "https://webui.example.com/",
    });

    assert.equal(response.status, 413);

    const contentLengthResponse = await app.request("https://worker.example.com/report-data?lang=en", {
      method: "POST",
      headers: {
        origin: "https://webui.example.com",
        "content-type": "application/json; charset=UTF-8",
        "content-length": String(5 * 1024 * 1024),
      },
      body: "{}",
    }, {
      REPORT_DATA_BUCKET: createMemoryBucket(),
      WEBUI_SITE_URL: "https://webui.example.com/",
    });

    assert.equal(contentLengthResponse.status, 413);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
});

test("admin routes accept bearer and legacy admin token headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  console.log = () => {};
  globalThis.fetch = async () => Response.json({
    ok: true,
    result: {
      url: "https://worker.example.com/webhook",
      pending_update_count: 0,
    },
  });

  try {
    for (const headers of [
      { authorization: "Bearer admin-secret" },
      { "x-admin-token": "admin-secret" },
    ]) {
      const response = await app.request("https://worker.example.com/admin/webhook", {
        headers,
      }, {
        ADMIN_TOKEN: "admin-secret",
        BOT_TOKEN: "bot-token",
      });

      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("admin and webhook routes reject invalid secrets", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  try {
    const adminResponse = await app.request("https://worker.example.com/admin/webhook", {
      headers: {
        authorization: "Bearer wrong-secret",
      },
    }, {
      ADMIN_TOKEN: "admin-secret",
      BOT_TOKEN: "bot-token",
    });
    assert.equal(adminResponse.status, 401);

    const webhookResponse = await app.request("https://worker.example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      body: "{}",
    }, {
      BOT_TOKEN: "bot-token",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    }, {
      passThroughOnException() {},
      waitUntil() {},
    });
    assert.equal(webhookResponse.status, 401);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
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

function createSampleReport() {
  return {
    locale: "en",
    fileName: "sample.apk",
    fileSizeBytes: 2048,
    fileSizeText: "2 KB",
    sourceLabel: "Private Chat Message",
    analyzedAt: "2026-07-08T00:00:00.000Z",
    featureIcons: {
      kotlin: "https://example.com/kotlin.svg",
      gradle: "https://example.com/gradle.svg",
      compose: "https://example.com/compose.svg",
    },
    apkInfo: {
      appName: "Sample",
      packageName: "com.example.sample",
      versionName: "1.0",
      versionCode: "1",
      targetSdk: 35,
      minSdk: 23,
      compileSdk: 35,
      icon: null,
      buildFeatures: {},
      permissions: ["android.permission.INTERNET"],
      nativeLibraries: [],
      components: {
        activities: [],
        services: [],
        receivers: [],
        providers: [],
      },
    },
  };
}

function createMemoryBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) {
      objects.set(key, { value, options });
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? {
            text: async () => object.value,
          }
        : null;
    },
  };
}
