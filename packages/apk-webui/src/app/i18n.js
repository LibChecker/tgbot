import { createI18n, getSupportedLocales, normalizeLocale, resolvePreferredLocale } from "@shared/i18n.js";

export { getSupportedLocales, normalizeLocale, resolvePreferredLocale };

let cachedLocale = "";
let cachedI18n = null;

export function translate(locale, key, variables = {}) {
  if (locale !== cachedLocale || !cachedI18n) {
    cachedLocale = locale;
    cachedI18n = createI18n(locale, { scope: "webui" });
  }

  return cachedI18n.t(key, variables);
}
