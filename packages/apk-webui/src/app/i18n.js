import { createI18n, getSupportedLocales, normalizeLocale, resolvePreferredLocale } from "@shared/i18n.js";

export { getSupportedLocales, normalizeLocale, resolvePreferredLocale };

const NON_TRANSLATABLE_MESSAGES = Object.freeze({
  title: "LibChecker WebUI",
  tabSdk: "SDK",
  tabRaw: "JSON",
  versionName: "versionName",
  versionCode: "versionCode",
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

export function translate(locale, key, variables = {}) {
  if (Object.prototype.hasOwnProperty.call(NON_TRANSLATABLE_MESSAGES, key)) {
    return formatMessage(NON_TRANSLATABLE_MESSAGES[key], variables);
  }

  if (locale !== cachedLocale || !cachedI18n) {
    cachedLocale = locale;
    cachedI18n = createI18n(locale, { scope: "webui" });
  }

  return cachedI18n.t(key, variables);
}

function formatMessage(template, variables) {
  return String(template).replace(/\{(\w+)\}/gu, (_, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}
