import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const interactionSource = await readFile(
  new URL("../src/app/report-preview-interactions.js", import.meta.url),
  "utf8",
);

test("SDK rule previews resolve compare labels from the shared detail registry", () => {
  assert.match(
    interactionSource,
    /import \{ getRegisteredSdkRuleDetail \} from "\.\/sdk-icon-renderer\.js";/u,
  );
  assert.match(
    interactionSource,
    /const detail = getRegisteredSdkRuleDetail\(label\.dataset\.ruleDetailId\);/u,
  );
  assert.doesNotMatch(interactionSource, /runtime\.sdkIconRendererModule/u);
});

test("non-Chinese locales prefer English SDK rule details", () => {
  const chineseFallback = interactionSource.indexOf("chineseFallback ||");
  const englishFallback = interactionSource.indexOf("locales.en ||", chineseFallback);

  assert.ok(chineseFallback >= 0);
  assert.ok(englishFallback > chineseFallback);
  assert.match(interactionSource, /state\.locale\.startsWith\("zh"\)/u);
});
