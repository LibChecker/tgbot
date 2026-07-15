export function createCatalogI18n(locale, dictionary, defaultDictionary = dictionary, options = {}) {
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

function normalizeScope(value) {
  const scope = String(value || "").trim();
  return scope.length > 0 ? scope : null;
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
