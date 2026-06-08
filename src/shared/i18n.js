import { DEFAULT_LOCALE, I18N_CATALOGS, SUPPORTED_LOCALES } from "./generated/i18n-catalogs.js";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };

export function createI18n(localeInput, options = {}) {
  const locale = normalizeLocale(localeInput);
  const dictionary = I18N_CATALOGS[locale] || I18N_CATALOGS[DEFAULT_LOCALE];
  const defaultDictionary = I18N_CATALOGS[DEFAULT_LOCALE];
  const scope = normalizeScope(options.scope);

  return {
    locale,
    languageTag: locale,
    t(key, variables = {}) {
      const template =
        resolveScopedMessage(dictionary, key, scope) ??
        resolveScopedMessage(defaultDictionary, key, scope) ??
        key;
      return formatMessage(template, variables);
    },
  };
}

export function normalizeLocale(value) {
  const normalized = normalizeLocaleText(value);
  if (!normalized) {
    return DEFAULT_LOCALE;
  }

  const exact = SUPPORTED_LOCALES.find((locale) => normalizeLocaleText(locale) === normalized);
  if (exact) {
    return exact;
  }

  const language = normalized.split("-")[0];
  const languageMatch = SUPPORTED_LOCALES.find((locale) => normalizeLocaleText(locale).split("-")[0] === language);
  if (languageMatch) {
    return languageMatch;
  }

  return DEFAULT_LOCALE;
}

export function getSupportedLocales() {
  return SUPPORTED_LOCALES.map((locale) => {
    const catalog = I18N_CATALOGS[locale] || {};
    return {
      locale,
      languageTag: locale,
      nativeName: catalog.locale?.nativeName || locale,
      englishName: catalog.locale?.englishName || locale,
    };
  });
}

export function resolveTelegramLocale(message) {
  const candidates = [
    message?.from?.language_code,
    message?.reply_to_message?.from?.language_code,
    message?.external_reply?.origin?.sender_user?.language_code,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return normalizeLocale(candidate);
    }
  }

  return DEFAULT_LOCALE;
}

function normalizeScope(value) {
  const scope = String(value || "").trim();
  return scope.length > 0 ? scope : null;
}

function normalizeLocaleText(value) {
  return String(value || "").trim().replace(/_/gu, "-").toLowerCase();
}

function resolveScopedMessage(dictionary, key, scope) {
  if (scope) {
    return resolveMessage(dictionary?.[scope], key);
  }

  return resolveMessage(dictionary, key);
}

function resolveMessage(dictionary, key) {
  return key.split(".").reduce((current, part) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return current[part];
  }, dictionary);
}

function formatMessage(template, variables) {
  return String(template).replace(/\{(\w+)\}/gu, (_, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}
