import { isLibCheckerRule } from "./contracts.js";

/** @typedef {import("./contracts.js").ApkInfo} ApkInfo */
/** @typedef {import("./contracts.js").LibCheckerRule} LibCheckerRule */
/** @typedef {import("./contracts.js").LibCheckerRuleDetailMap} LibCheckerRuleDetailMap */
/** @typedef {import("./contracts.js").SdkMarkerAnnotations} SdkMarkerAnnotations */

const RULE_TYPE_NATIVE = 0;
const RULE_TYPE_SERVICE = 1;
const RULE_TYPE_ACTIVITY = 2;
const RULE_TYPE_RECEIVER = 3;
const RULE_TYPE_PROVIDER = 4;
const RULE_TYPE_ACTION = 9;

const COMPONENT_TYPE_LABELS = {
  activities: "Activity",
  services: "Service",
  receivers: "Receiver",
  providers: "Provider",
};

const QIHOO_NATIVE_LIBS = new Set([
  "libjiagu.so",
  "libjiagu_a64.so",
  "libjiagu_x86.so",
  "libjiagu_x64.so",
]);

const SECNEO_NATIVE_LIBS = new Set([
  "libDexHelper.so",
  "libDexHelper-x86.so",
  "libdexjni.so",
]);

const FLUTTER_VALIDATION_LIBS = new Set(["libapp.so"]);
const UNITY_VALIDATION_LIBS = new Set(["libmain.so"]);
const compiledRuleIndexes = new WeakMap();
const EMPTY_RULE_INDEX = new Map();

/**
 * @param {ApkInfo} apkInfo
 * @param {(iconName: string) => string} resolveIconUrl
 * @param {readonly LibCheckerRule[]} [rules]
 * @param {LibCheckerRuleDetailMap | null} [ruleDetails]
 * @returns {SdkMarkerAnnotations}
 */
export function annotateSdkMarkers(apkInfo, resolveIconUrl, rules = [], ruleDetails = null) {
  return annotateSdkMarkersWithRuleIndex(
    apkInfo,
    resolveIconUrl,
    getCompiledRuleIndex(rules),
    ruleDetails,
  );
}

/**
 * @param {readonly LibCheckerRule[]} [rules]
 * @param {LibCheckerRuleDetailMap | null} [ruleDetails]
 * @returns {(apkInfo: ApkInfo, resolveIconUrl: (iconName: string) => string) => SdkMarkerAnnotations}
 */
export function createSdkMarkerAnnotator(rules = [], ruleDetails = null) {
  const ruleIndex = getCompiledRuleIndex(rules);
  return (apkInfo, resolveIconUrl) => annotateSdkMarkersWithRuleIndex(
    apkInfo,
    resolveIconUrl,
    ruleIndex,
    ruleDetails,
  );
}

function annotateSdkMarkersWithRuleIndex(apkInfo, resolveIconUrl, ruleIndex, ruleDetails = null) {
  const nativeLibraries = apkInfo.nativeLibraries.map((library) => ({
    ...library,
    sdk: matchNativeLibraryRule(library, apkInfo, resolveIconUrl, ruleIndex, ruleDetails),
  }));

  const components = {
    activities: annotateComponentList(
      apkInfo.components.activities,
      RULE_TYPE_ACTIVITY,
      resolveIconUrl,
      ruleIndex,
      ruleDetails,
    ),
    services: annotateComponentList(
      apkInfo.components.services,
      RULE_TYPE_SERVICE,
      resolveIconUrl,
      ruleIndex,
      ruleDetails,
    ),
    receivers: annotateComponentList(
      apkInfo.components.receivers,
      RULE_TYPE_RECEIVER,
      resolveIconUrl,
      ruleIndex,
      ruleDetails,
    ),
    providers: annotateComponentList(
      apkInfo.components.providers,
      RULE_TYPE_PROVIDER,
      resolveIconUrl,
      ruleIndex,
      ruleDetails,
    ),
  };

  return {
    nativeLibraries,
    components,
    sdkSummary: {
      native: summarizeNativeSdkMarkers(nativeLibraries, resolveIconUrl),
      components: summarizeComponentSdkMarkers(components, resolveIconUrl),
    },
  };
}

function annotateComponentList(components, ruleType, resolveIconUrl, ruleIndex, ruleDetails) {
  return components.map((component) => ({
    ...component,
    sdk: matchComponentRule(component, ruleType, resolveIconUrl, ruleIndex, ruleDetails),
  }));
}

function matchNativeLibraryRule(library, apkInfo, resolveIconUrl, ruleIndex, ruleDetails) {
  const rule = findRule(ruleIndex, library.name, RULE_TYPE_NATIVE, true);
  if (!rule) {
    return null;
  }

  if (!passesNativeRuleValidation(library.name, apkInfo)) {
    return null;
  }

  return materializeRule(rule, resolveIconUrl, rule.isRegexRule ? "regex" : "exact", ruleDetails);
}

function matchComponentRule(component, ruleType, resolveIconUrl, ruleIndex, ruleDetails) {
  const directRule = findRule(ruleIndex, component.name, ruleType, true);
  if (directRule) {
    return materializeRule(
      directRule,
      resolveIconUrl,
      directRule.isRegexRule ? "regex" : "exact",
      ruleDetails,
    );
  }

  for (const action of component.actions || []) {
    const actionRule = findRule(ruleIndex, action, RULE_TYPE_ACTION, false);
    if (actionRule) {
      return materializeRule(actionRule, resolveIconUrl, "action", ruleDetails);
    }
  }

  return null;
}

function findRule(ruleIndex, name, type, useRegex) {
  const group = ruleIndex.get(type);
  if (!group) {
    return null;
  }

  const directRule = group.exact.get(name);
  if (directRule) {
    return directRule;
  }

  if (!useRegex) {
    return null;
  }

  for (const item of group.regex) {
    if (item.pattern.test(name)) {
      return item.rule;
    }
  }

  return null;
}

function materializeRule(rule, resolveIconUrl, matchSource, ruleDetails = null) {
  const detailKey = rule.detailKey || buildRuleDetailMapKey(rule);
  return {
    label: rule.label,
    iconName: rule.iconName,
    iconUrl: resolveIconUrl(rule.iconName),
    singleColorIcon: Boolean(rule.singleColorIcon),
    matchSource,
    regexName: rule.regexName || null,
    detailKey: detailKey || null,
    ruleDetail: resolveRuleDetail(rule, ruleDetails),
    type: rule.type,
  };
}

function passesNativeRuleValidation(libraryName, apkInfo) {
  const nativeValidation = apkInfo.buildFeatures?.nativeValidation || {};

  if (QIHOO_NATIVE_LIBS.has(libraryName)) {
    return Boolean(nativeValidation.qihooDetected);
  }

  if (SECNEO_NATIVE_LIBS.has(libraryName)) {
    return Boolean(nativeValidation.secneoDetected);
  }

  if (FLUTTER_VALIDATION_LIBS.has(libraryName)) {
    return (
      apkInfo.nativeLibraries.some((item) => item.name === "libflutter.so") ||
      Boolean(nativeValidation.flutterInjectorDetected)
    );
  }

  if (UNITY_VALIDATION_LIBS.has(libraryName)) {
    return apkInfo.nativeLibraries.some((item) => item.name === "libunity.so");
  }

  return true;
}

function summarizeNativeSdkMarkers(libraries, resolveIconUrl) {
  const grouped = new Map();

  for (const library of libraries) {
    if (!library.sdk) {
      continue;
    }

    const key = buildSdkGroupKey(library.sdk);
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        key,
        label: library.sdk.label,
        iconName: library.sdk.iconName,
        iconUrl: resolveIconUrl(library.sdk.iconName),
        singleColorIcon: Boolean(library.sdk.singleColorIcon),
        detailKey: library.sdk.detailKey || null,
        ruleDetail: library.sdk.ruleDetail || null,
        count: 0,
        fileCount: 0,
        items: [],
        itemNames: new Set(),
        abis: new Set(),
      };
      grouped.set(key, entry);
    }

    entry.fileCount += 1;
    entry.items.push(library);
    entry.abis.add(library.abi);

    if (!entry.itemNames.has(library.name)) {
      entry.itemNames.add(library.name);
      entry.count += 1;
    }
  }

  return [...grouped.values()]
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      iconName: entry.iconName,
      iconUrl: entry.iconUrl,
      singleColorIcon: entry.singleColorIcon,
      detailKey: entry.detailKey || null,
      ruleDetail: entry.ruleDetail || null,
      count: entry.count,
      detail: buildNativeSummaryDetail(entry),
      previewItems: [...entry.itemNames].slice(0, 4),
    }))
    .sort(compareSummaryEntries);
}

function summarizeComponentSdkMarkers(components, resolveIconUrl) {
  const grouped = new Map();

  for (const [sectionName, items] of Object.entries(components)) {
    const componentTypeLabel = COMPONENT_TYPE_LABELS[sectionName] || "Component";
    for (const component of items) {
      if (!component.sdk) {
        continue;
      }

      const key = buildSdkGroupKey(component.sdk);
      let entry = grouped.get(key);
      if (!entry) {
        entry = {
          key,
          label: component.sdk.label,
          iconName: component.sdk.iconName,
          iconUrl: resolveIconUrl(component.sdk.iconName),
          singleColorIcon: Boolean(component.sdk.singleColorIcon),
          detailKey: component.sdk.detailKey || null,
          ruleDetail: component.sdk.ruleDetail || null,
          count: 0,
          items: [],
          componentKinds: new Map(),
        };
        grouped.set(key, entry);
      }

      entry.count += 1;
      entry.items.push(component);
      entry.componentKinds.set(
        componentTypeLabel,
        (entry.componentKinds.get(componentTypeLabel) || 0) + 1,
      );
    }
  }

  return [...grouped.values()]
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      iconName: entry.iconName,
      iconUrl: entry.iconUrl,
      singleColorIcon: entry.singleColorIcon,
      detailKey: entry.detailKey || null,
      ruleDetail: entry.ruleDetail || null,
      count: entry.count,
      detail: buildComponentSummaryDetail(entry),
      previewItems: entry.items
        .map((item) => item.shortName || item.name)
        .filter(Boolean)
        .slice(0, 4),
    }))
    .sort(compareSummaryEntries);
}

function buildNativeSummaryDetail(entry) {
  const abiText = [...entry.abis].sort().join(", ");
  if (!abiText) {
    return `${entry.fileCount} 个文件`;
  }

  return `${entry.count} 个库名 · ${entry.fileCount} 个文件 · ABI ${abiText}`;
}

function buildComponentSummaryDetail(entry) {
  return [...entry.componentKinds.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type} ${count}`)
    .join(" · ");
}

function buildSdkGroupKey(sdk) {
  return `${sdk.label}::${sdk.iconName}`;
}

function compareSummaryEntries(left, right) {
  if (left.count !== right.count) {
    return right.count - left.count;
  }

  return left.label.localeCompare(right.label);
}

function getCompiledRuleIndex(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return EMPTY_RULE_INDEX;
  }

  const cached = compiledRuleIndexes.get(rules);
  if (cached) {
    return cached;
  }

  const index = compileRuleIndex(rules);
  compiledRuleIndexes.set(rules, index);
  return index;
}

function compileRuleIndex(rules) {
  const index = new Map();

  for (const rule of rules) {
    if (!isLibCheckerRule(rule)) {
      continue;
    }

    const typeGroup = index.get(rule.type) || { exact: new Map(), regex: [] };
    const normalizedRule = {
      name: rule.name,
      label: rule.label,
      type: rule.type,
      iconName: rule.iconName,
      singleColorIcon: Boolean(rule.singleColorIcon),
      isRegexRule: Boolean(rule.isRegexRule),
      regexName: rule.regexName || null,
      detailKey: buildRuleDetailMapKey(rule),
    };

    if (normalizedRule.isRegexRule) {
      try {
        typeGroup.regex.push({
          pattern: new RegExp(`^${normalizedRule.name}$`, "u"),
          rule: normalizedRule,
        });
      } catch {
        // Skip malformed upstream regex rules.
      }
    } else {
      typeGroup.exact.set(normalizedRule.name, normalizedRule);
    }

    index.set(rule.type, typeGroup);
  }

  return index;
}

function resolveRuleDetail(rule, ruleDetails) {
  if (!ruleDetails || typeof ruleDetails !== "object") {
    return null;
  }

  const detailKey = rule.detailKey || buildRuleDetailMapKey(rule);
  return detailKey ? ruleDetails[detailKey] || null : null;
}

export function buildRuleDetailMapKey(rule) {
  if (!rule || !Number.isFinite(rule.type)) {
    return "";
  }

  if (rule.isRegexRule && rule.regexName) {
    return `${rule.type}::regex/${rule.regexName}`;
  }

  return rule.name ? `${rule.type}::${rule.name}` : "";
}
