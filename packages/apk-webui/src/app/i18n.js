import { getSupportedLocales, normalizeLocale, resolvePreferredLocale } from "@shared/i18n-locales.js";
import { createCatalogI18n } from "@shared/i18n-runtime.js";
import { loadLocaleCatalog } from "./locale-catalog-loader.js";

export { getSupportedLocales, normalizeLocale, resolvePreferredLocale };

const NON_TRANSLATABLE_MESSAGES = Object.freeze({
  title: "LibChecker WebUI",
  tabSdk: "SDK",
  tabRaw: "JSON",
  targetSdk: "Target SDK",
  minSdk: "Min SDK",
  compileSdk: "Compile SDK",
  activities: "Activity",
  services: "Service",
  receivers: "Receiver",
  providers: "Provider",
  exported: "exported",
  notExported: "not exported",
  enabled: "enabled",
  disabled: "disabled",
  authorities: "authorities",
  actions: "actions",
  targetActivity: "targetActivity",
  sdk: "SDK",
  abi: "ABI",
  ruleUuid: "UUID",
  signatureMd5: "MD5",
  signatureSha1: "SHA1",
  signatureSha256: "SHA256",
  signatureCharString: "CharString",
  selectedFile: "{name} · {size}",
  completedIn: "{seconds}s",
  compareSlotReady: "{name} · {size}",
});

let cachedLocale = "";
let cachedI18n = null;
const localeI18n = new Map();

export async function loadLocale(localeInput) {
  const { locale, catalog } = await loadLocaleCatalog(localeInput);
  if (!localeI18n.has(locale)) {
    localeI18n.set(locale, createCatalogI18n(locale, catalog, catalog, { scope: "webui" }));
  }
  return locale;
}

export function translate(locale, key, variables = {}) {
  if (Object.prototype.hasOwnProperty.call(NON_TRANSLATABLE_MESSAGES, key)) {
    return formatMessage(NON_TRANSLATABLE_MESSAGES[key], variables);
  }

  const normalizedLocale = normalizeLocale(locale);
  if (normalizedLocale !== cachedLocale || !cachedI18n) {
    cachedLocale = normalizedLocale;
    cachedI18n = localeI18n.get(normalizedLocale) || null;
  }

  return cachedI18n?.t(key, variables) || key;
}

function formatMessage(template, variables) {
  return String(template).replace(/\{(\w+)\}/gu, (_, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}
