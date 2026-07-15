import { I18N_CATALOGS } from "./generated/i18n-catalogs.js";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getSupportedLocales,
  normalizeLocale,
  resolvePreferredLocale,
  resolveTelegramLocale,
} from "./i18n-locales.js";
import { createCatalogI18n } from "./i18n-runtime.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getSupportedLocales,
  normalizeLocale,
  resolvePreferredLocale,
  resolveTelegramLocale,
};

export function createI18n(localeInput, options = {}) {
  const locale = normalizeLocale(localeInput);
  const dictionary = I18N_CATALOGS[locale] || I18N_CATALOGS[DEFAULT_LOCALE];
  const defaultDictionary = I18N_CATALOGS[DEFAULT_LOCALE];
  return createCatalogI18n(locale, dictionary, defaultDictionary, options);
}
