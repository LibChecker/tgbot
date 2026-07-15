import { DEFAULT_LOCALE, normalizeLocale } from "@shared/i18n-locales.js";

const LOCALE_CATALOG_LOADERS = import.meta.glob("../../../../locales/*.json", {
  import: "default",
});
const loadedCatalogs = new Map();
const pendingCatalogs = new Map();

export async function loadLocaleCatalog(localeInput) {
  const locale = normalizeLocale(localeInput);

  try {
    return await loadExactLocaleCatalog(locale);
  } catch (error) {
    if (locale === DEFAULT_LOCALE) {
      throw error;
    }
    return loadExactLocaleCatalog(DEFAULT_LOCALE);
  }
}

async function loadExactLocaleCatalog(locale) {
  const loaded = loadedCatalogs.get(locale);
  if (loaded) {
    return { locale, catalog: loaded };
  }

  let pending = pendingCatalogs.get(locale);
  if (!pending) {
    const loader = LOCALE_CATALOG_LOADERS[`../../../../locales/${locale}.json`];
    if (!loader) {
      throw new Error(`Missing locale catalog loader: ${locale}`);
    }
    pending = loader()
      .then((catalog) => {
        if (!catalog || typeof catalog !== "object") {
          throw new Error(`Invalid locale catalog: ${locale}`);
        }
        loadedCatalogs.set(locale, catalog);
        return { locale, catalog };
      })
      .finally(() => {
        pendingCatalogs.delete(locale);
      });
    pendingCatalogs.set(locale, pending);
  }

  return pending;
}
