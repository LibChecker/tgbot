import assert from "node:assert/strict";
import test from "node:test";

import { getSupportedLocales } from "../src/i18n.js";

test("locale display names come from Intl.DisplayNames", () => {
  const options = { type: "language", fallback: "code" };
  const englishNames = new Intl.DisplayNames(["en"], options);

  for (const locale of getSupportedLocales()) {
    const languageTag = locale.languageTag.replace(/_/gu, "-");
    const nativeNames = new Intl.DisplayNames([languageTag], options);

    assert.equal(locale.nativeName, nativeNames.of(languageTag));
    assert.equal(locale.englishName, englishNames.of(languageTag));
  }
});
