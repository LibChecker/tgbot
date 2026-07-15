import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, mergeConfig } from "vite";

import viteConfig from "../vite.config.mjs";

let viteServer;
let reportShareModal;

before(async () => {
  viteServer = await createServer(mergeConfig(viteConfig, {
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  }));
  reportShareModal = await viteServer.ssrLoadModule("/app/report-share-modal.js");
});

after(async () => {
  await viteServer?.close();
});

test("report share backdrop closes only when the pointer starts on the backdrop", () => {
  const backdrop = {};
  const panel = {};

  assert.equal(
    reportShareModal.shouldCloseReportShareModalOnBackdropClick({ target: backdrop }, backdrop, true),
    true,
  );
  assert.equal(
    reportShareModal.shouldCloseReportShareModalOnBackdropClick({ target: backdrop }, backdrop, false),
    false,
  );
  assert.equal(
    reportShareModal.shouldCloseReportShareModalOnBackdropClick({ target: panel }, backdrop, true),
    false,
  );
});

test("report share CSS durations are converted to milliseconds", () => {
  assert.equal(reportShareModal.parseCssTimeMs("150ms", 1), 150);
  assert.equal(reportShareModal.parseCssTimeMs("0.25s", 1), 250);
  assert.equal(reportShareModal.parseCssTimeMs("invalid", 150), 150);
});
