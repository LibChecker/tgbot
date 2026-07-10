import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, mergeConfig } from "vite";

import { LIBCHECKER_SDK_ICON_SVGS } from "../../shared/src/generated/libchecker-sdk-icons.js";
import viteConfig from "../vite.config.mjs";

let sdkIconCache;
let viteServer;

before(async () => {
  viteServer = await createServer(mergeConfig(viteConfig, {
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  }));
  sdkIconCache = await viteServer.ssrLoadModule("/app/sdk-icon-cache.js");
});

after(async () => {
  await viteServer?.close();
});

test("Kotlin build feature replaces a previously cached KMP icon", async () => {
  const staleKmpIcon = toSvgDataUri(LIBCHECKER_SDK_ICON_SVGS.ic_lib_jetbrain_kmp);
  const report = {
    apkInfo: {},
    featureIcons: { kotlin: staleKmpIcon },
  };

  await sdkIconCache.hydrateReportSdkIconImages(report);

  assert.equal(
    decodeSvgDataUri(report.featureIcons.kotlin),
    LIBCHECKER_SDK_ICON_SVGS.ic_lib_kotlin,
  );
  assert.notEqual(report.featureIcons.kotlin, staleKmpIcon);
});

test("Gradle build features use the generated icon resource", async () => {
  const report = {
    apkInfo: {},
    featureIcons: { gradle: "data:image/svg+xml;charset=UTF-8,legacy" },
  };

  await sdkIconCache.hydrateReportSdkIconImages(report);

  assert.equal(
    decodeSvgDataUri(report.featureIcons.gradle),
    LIBCHECKER_SDK_ICON_SVGS.ic_gradle,
  );
  assert.equal(report.featureIcons.agp, report.featureIcons.gradle);
});

function toSvgDataUri(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function decodeSvgDataUri(dataUri) {
  return decodeURIComponent(dataUri.slice(dataUri.indexOf(",") + 1));
}
