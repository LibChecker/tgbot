import { createI18n, getSupportedLocales, normalizeLocale } from "../modules/i18n.js";

export { getSupportedLocales, normalizeLocale };

export function translate(locale, key, variables = {}) {
  return createI18n(locale, { scope: "webui" }).t(key, variables);
}
