import assert from "node:assert/strict";
import test from "node:test";

import { createI18n, getSupportedLocales, normalizeLocale } from "../src/i18n.js";

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

test("supported locale list includes the added catalogs", () => {
  const locales = getSupportedLocales().map(({ locale }) => locale);

  assert.ok(locales.includes("ja"));
  assert.ok(locales.includes("ko"));
  assert.ok(locales.includes("zh-Hant"));
});

test("regional Chinese, Japanese, and Korean locales resolve to supported catalogs", () => {
  assert.equal(normalizeLocale("ja-JP"), "ja");
  assert.equal(normalizeLocale("ko-KR"), "ko");
  assert.equal(normalizeLocale("zh-TW"), "zh-Hant");
  assert.equal(normalizeLocale("zh-HK"), "zh-Hant");
  assert.equal(normalizeLocale("zh-Hant-TW"), "zh-Hant");
});

test("added catalogs translate bot and WebUI copy", () => {
  assert.equal(createI18n("ja", { scope: "webui" }).t("languageLabel"), "言語");
  assert.equal(createI18n("ko", { scope: "bot" }).t("open_full_report"), "전체 보고서 열기");
  assert.equal(createI18n("zh-Hant", { scope: "commands" }).t("start_description"), "顯示使用說明");
});
