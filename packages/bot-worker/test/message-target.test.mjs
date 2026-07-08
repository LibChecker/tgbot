import assert from "node:assert/strict";
import test from "node:test";

import { __botWorkerTestInternals } from "../src/index.js";

const { buildMessageTelemetryFields, selectTargetDocument, selectTargetUrl } = __botWorkerTestInternals;

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
