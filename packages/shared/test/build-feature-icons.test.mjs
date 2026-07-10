import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILD_FEATURE_ICON_NAMES,
} from "../src/build-feature-icons.js";
import { LIBCHECKER_SDK_ICON_SVGS } from "../src/generated/libchecker-sdk-icons.js";

test("generated icons include the Kotlin build feature icon", () => {
  assert.match(LIBCHECKER_SDK_ICON_SVGS.ic_lib_kotlin, /^<svg\b/u);
  assert.equal(BUILD_FEATURE_ICON_NAMES.kotlin, "ic_lib_kotlin");
  assert.notEqual(
    LIBCHECKER_SDK_ICON_SVGS.ic_lib_kotlin,
    LIBCHECKER_SDK_ICON_SVGS.ic_lib_jetbrain_kmp,
  );
});

test("generated icons include the themeable Gradle build feature icon", () => {
  assert.match(LIBCHECKER_SDK_ICON_SVGS.ic_gradle, /^<svg\b/u);
  assert.equal(BUILD_FEATURE_ICON_NAMES.agp, "ic_gradle");
  assert.equal(BUILD_FEATURE_ICON_NAMES.gradle, "ic_gradle");
});
