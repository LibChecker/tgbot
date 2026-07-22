import assert from "node:assert/strict";
import test from "node:test";
import {
  initializePwaShareTarget,
  SHARED_APK_CACHE,
  SHARED_APK_PATH,
} from "../src/app/pwa-share-target.js";

test("PWA share target registers its worker and consumes a cached APK once", async () => {
  const registrations = [];
  const deleted = [];
  const opened = [];
  const historyUrls = [];
  const origin = "https://example.com";
  const cacheKey = `${origin}${SHARED_APK_PATH}`;
  const response = new Response("apk bytes", {
    headers: {
      "content-type": "application/vnd.android.package-archive",
      "x-pwa-file-name": encodeURIComponent("shared app.apk"),
      "x-pwa-file-last-modified": "1234",
    },
  });
  const cacheStorage = {
    async open(name) {
      assert.equal(name, SHARED_APK_CACHE);
      return {
        async match(key) {
          assert.equal(key, cacheKey);
          return response;
        },
        async delete(key) {
          deleted.push(key);
          return true;
        },
      };
    },
  };

  const result = await initializePwaShareTarget((file) => opened.push(file), {
    cacheStorage,
    historyRef: {
      state: { kept: true },
      replaceState(_state, _title, url) {
        historyUrls.push(url);
      },
    },
    locationRef: new URL(`${origin}/?share-target=ready&lang=zh-Hans`),
    serviceWorkerContainer: {
      async register(...args) {
        registrations.push(args);
      },
    },
  });

  assert.deepEqual(result, { consumed: true, registered: true });
  assert.deepEqual(registrations, [["/share-target-sw.js", { scope: "/" }]]);
  assert.deepEqual(historyUrls, ["/?lang=zh-Hans"]);
  assert.deepEqual(deleted, [cacheKey]);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].name, "shared app.apk");
  assert.equal(opened[0].type, "application/vnd.android.package-archive");
  assert.equal(opened[0].lastModified, 1234);
  assert.equal(await opened[0].text(), "apk bytes");
});

