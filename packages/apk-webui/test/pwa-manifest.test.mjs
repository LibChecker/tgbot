import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicDir = new URL("../src/public/", import.meta.url);

test("PWA manifest declares install metadata and Android package file handling", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", publicDir), "utf8"));

  assert.equal(manifest.name, "LibChecker WebUI");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(manifest.icons, [
    {
      src: "/pwa-icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa-icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ]);
  assert.deepEqual(manifest.file_handlers, [{
    action: "/",
    accept: {
      "application/vnd.android.package-archive": [".apk"],
      "application/zip": [".apks", ".apkm", ".xapk"],
    },
    launch_type: "multiple-clients",
  }]);
  assert.deepEqual(manifest.share_target, {
    action: "/share-target",
    method: "POST",
    enctype: "multipart/form-data",
    params: {
      files: [{
        name: "apk",
        accept: ["application/vnd.android.package-archive", ".apk"],
      }],
    },
  });
});

for (const size of [192, 512]) {
  test(`PWA ${size}px icon is a correctly sized PNG`, async () => {
    const icon = await readFile(new URL(`pwa-icon-${size}.png`, publicDir));
    assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(icon.readUInt32BE(16), size);
    assert.equal(icon.readUInt32BE(20), size);
  });
}
