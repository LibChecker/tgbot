import assert from "node:assert/strict";
import { test } from "node:test";

import { BUILD_FEATURE_ICON_NAMES } from "../../shared/src/build-feature-icons.js";
import { LIBCHECKER_SDK_ICON_SVGS } from "../../shared/src/generated/libchecker-sdk-icons.js";
import rulesLock from "../../shared/rules.lock.json" with { type: "json" };
import { buildSdkIconUrl, buildFeatureIconUrl, handleIconRequest } from "../src/icons.js";

test("feature icon routes reuse generated LibChecker icon resources", async () => {
  for (const [featureName, iconName] of Object.entries(BUILD_FEATURE_ICON_NAMES)) {
    const response = await handleIconRequest(`/assets/icons/${featureName}.svg`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), LIBCHECKER_SDK_ICON_SVGS[iconName]);
  }
});

test("icon URLs invalidate caches when the pinned portable release changes", () => {
  const hash = rulesLock.manifest.artifacts.portable.sha256;
  assert.equal(new URL(buildSdkIconUrl("https://example.test/", "ic_lib_kotlin")).searchParams.get("v"), hash);
  assert.equal(new URL(buildFeatureIconUrl("https://example.test/", "gradle")).searchParams.get("v"), hash);
});
