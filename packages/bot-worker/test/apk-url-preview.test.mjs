import assert from "node:assert/strict";
import test from "node:test";

import { parseHttpUrl } from "../src/apk-url-preview.js";

test("parseHttpUrl rejects blocked localhost and private hosts", () => {
  const blockedUrls = [
    "http://localhost/file.apk",
    "https://LOCALHOST/file.apk",
    "http://127.0.0.1/file.apk",
    "http://127.1/file.apk",
    "http://127.0.1/file.apk",
    "http://2130706433/file.apk",
    "http://0x7f000001/file.apk",
    "http://0177.0.0.1/file.apk",
    "http://3232235521/file.apk",
    "https://[::1]/file.apk",
    "http://192.168.1.1/file.apk",
    "https://[fe80::1]/file.apk",
    "http://example.local/file.apk",
    "http://example.local./file.apk",
  ];

  for (const url of blockedUrls) {
    assert.throws(
      () => parseHttpUrl(url),
      (error) => error instanceof Error && error.code === "invalid_download_url",
    );
  }
});

test("parseHttpUrl accepts public URLs and removes URL fragments", () => {
  const url = parseHttpUrl("https://example.com/sample.apk#preview");

  assert.equal(url.href, "https://example.com/sample.apk");
});

test("parseHttpUrl enforces supported URL schemes", () => {
  assert.throws(
    () => parseHttpUrl("ftp://example.com/sample.apk"),
    (error) => error instanceof Error && error.code === "invalid_download_url",
  );
});
