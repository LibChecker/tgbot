import { createI18n, getSupportedLocales, normalizeLocale, resolvePreferredLocale } from "@shared/i18n.js";

export { getSupportedLocales, normalizeLocale, resolvePreferredLocale };

export function translate(locale, key, variables = {}) {
  return createI18n(locale, { scope: "webui" }).t(key, variables);
}
