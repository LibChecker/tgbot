import assert from "node:assert/strict";
import test from "node:test";
import { registerPwaFileHandler } from "../src/app/pwa-file-handler.js";

test("PWA file handler registers a launch consumer and forwards the first file", async () => {
  let consumer;
  const launchQueueRef = {
    setConsumer(value) {
      consumer = value;
    },
  };
  const opened = [];

  assert.equal(registerPwaFileHandler((file) => {
    opened.push(file);
  }, { launchQueueRef }), true);

  const firstFile = new File(["first"], "first.apk");
  const secondFile = new File(["second"], "second.apk");
  await consumer({
    files: [
      { async getFile() { return firstFile; } },
      { async getFile() { return secondFile; } },
    ],
  });

  assert.deepEqual(opened, [firstFile]);
});

test("PWA file handler ignores empty launches and unsupported hosts", async () => {
  let consumer;
  let opened = false;
  const launchQueueRef = {
    setConsumer(value) {
      consumer = value;
    },
  };

  assert.equal(registerPwaFileHandler(() => {
    opened = true;
  }, { launchQueueRef: null }), false);
  assert.equal(registerPwaFileHandler(() => {
    opened = true;
  }, { launchQueueRef }), true);

  await consumer({ files: [] });
  await consumer({ files: [{ name: "not-a-file-handle" }] });
  assert.equal(opened, false);
});

test("PWA file handler reports file and callback failures", async () => {
  let consumer;
  const errors = [];
  const launchQueueRef = {
    setConsumer(value) {
      consumer = value;
    },
  };
  const readError = new Error("read failed");

  registerPwaFileHandler(() => {}, {
    launchQueueRef,
    onError(error) {
      errors.push(error);
    },
  });
  await consumer({ files: [{ async getFile() { throw readError; } }] });

  const callbackError = new Error("analysis failed");
  registerPwaFileHandler(async () => {
    throw callbackError;
  }, {
    launchQueueRef,
    onError(error) {
      errors.push(error);
    },
  });
  await consumer({ files: [{ async getFile() { return new File([], "app.apk"); } }] });

  assert.deepEqual(errors, [readError, callbackError]);
});

test("PWA file handler rejects a missing callback", () => {
  assert.throws(
    () => registerPwaFileHandler(null, { launchQueueRef: null }),
    /requires an onFile callback/u,
  );
});
