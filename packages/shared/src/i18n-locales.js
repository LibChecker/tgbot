import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./generated/i18n-locales.js";

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };

const LOCALE_ALIASES = new Map([
  ["zh", "zh-Hans"],
  ["zh-cn", "zh-Hans"],
  ["zh-hk", "zh-Hant"],
  ["zh-mo", "zh-Hant"],
  ["zh-sg", "zh-Hans"],
  ["zh-tw", "zh-Hant"],
  ["zh-my", "zh-Hans"],
  ["zh-hans", "zh-Hans"],
  ["zh-hans-cn", "zh-Hans"],
  ["zh-hans-sg", "zh-Hans"],
  ["zh-hans-my", "zh-Hans"],
  ["zh-hant", "zh-Hant"],
  ["zh-hant-hk", "zh-Hant"],
  ["zh-hant-mo", "zh-Hant"],
  ["zh-hant-tw", "zh-Hant"],
]);

const LANGUAGE_DISPLAY_NAME_FORMATTERS = new Map();

export function normalizeLocale(value) {
  return resolveSupportedLocale(value) || DEFAULT_LOCALE;
}

export function resolvePreferredLocale(values, fallbackLocale = DEFAULT_LOCALE) {
  const candidates = Array.isArray(values) ? values : [values];
  for (const candidate of candidates) {
    const locale = resolveSupportedLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return resolveSupportedLocale(fallbackLocale) || DEFAULT_LOCALE;
}

export function resolveSupportedLocale(value) {
  const normalized = normalizeLocaleText(value);
  if (!normalized) {
    return null;
  }

  const alias = LOCALE_ALIASES.get(normalized);
  if (alias && SUPPORTED_LOCALES.includes(alias)) {
    return alias;
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

  return null;
}

export function getSupportedLocales() {
  return SUPPORTED_LOCALES.map((locale) => ({
    locale,
    languageTag: locale,
    nativeName: getLanguageDisplayName(locale, locale),
    englishName: getLanguageDisplayName(locale, "en"),
  }));
}

export function resolveTelegramLocale(message) {
  const candidates = [
    message?.from?.language_code,
    message?.reply_to_message?.from?.language_code,
    message?.external_reply?.origin?.sender_user?.language_code,
  ];

  for (const candidate of candidates) {
    const locale = resolveSupportedLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return DEFAULT_LOCALE;
}

function getLanguageDisplayName(locale, displayLocale) {
  const languageTag = String(locale).replace(/_/gu, "-");
  const displayLanguageTag = String(displayLocale).replace(/_/gu, "-");

  try {
    let formatter = LANGUAGE_DISPLAY_NAME_FORMATTERS.get(displayLanguageTag);
    if (!formatter) {
      formatter = new Intl.DisplayNames([displayLanguageTag], {
        type: "language",
        fallback: "code",
      });
      LANGUAGE_DISPLAY_NAME_FORMATTERS.set(displayLanguageTag, formatter);
    }
    return formatter.of(languageTag) || locale;
  } catch {
    return locale;
  }
}

function normalizeLocaleText(value) {
  return String(value || "").trim().replace(/_/gu, "-").toLowerCase();
}
