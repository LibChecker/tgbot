import { LIBCHECKER_RULES } from "./generated/libchecker-rules.js";

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

const COMPILED_RULE_INDEX = compileRuleIndex(LIBCHECKER_RULES);

export function annotateSdkMarkers(apkInfo, resolveIconUrl) {
  const nativeLibraries = apkInfo.nativeLibraries.map((library) => ({
    ...library,
    sdk: matchNativeLibraryRule(library, apkInfo, resolveIconUrl),
  }));

  const components = {
    activities: annotateComponentList(
      apkInfo.components.activities,
      RULE_TYPE_ACTIVITY,
      resolveIconUrl,
    ),
    services: annotateComponentList(
      apkInfo.components.services,
      RULE_TYPE_SERVICE,
      resolveIconUrl,
    ),
    receivers: annotateComponentList(
      apkInfo.components.receivers,
      RULE_TYPE_RECEIVER,
      resolveIconUrl,
    ),
    providers: annotateComponentList(
      apkInfo.components.providers,
      RULE_TYPE_PROVIDER,
      resolveIconUrl,
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

function annotateComponentList(components, ruleType, resolveIconUrl) {
  return components.map((component) => ({
    ...component,
    sdk: matchComponentRule(component, ruleType, resolveIconUrl),
  }));
}

function matchNativeLibraryRule(library, apkInfo, resolveIconUrl) {
  const rule = findRule(library.name, RULE_TYPE_NATIVE, true);
  if (!rule) {
    return null;
  }

  if (!passesNativeRuleValidation(library.name, apkInfo)) {
    return null;
  }

  return materializeRule(rule, resolveIconUrl, rule.isRegexRule ? "regex" : "exact");
}

function matchComponentRule(component, ruleType, resolveIconUrl) {
  const directRule = findRule(component.name, ruleType, true);
  if (directRule) {
    return materializeRule(
      directRule,
      resolveIconUrl,
      directRule.isRegexRule ? "regex" : "exact",
    );
  }

  for (const action of component.actions || []) {
    const actionRule = findRule(action, RULE_TYPE_ACTION, false);
    if (actionRule) {
      return materializeRule(actionRule, resolveIconUrl, "action");
    }
  }

  return null;
}

function findRule(name, type, useRegex) {
  const group = COMPILED_RULE_INDEX.get(type);
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

function materializeRule(rule, resolveIconUrl, matchSource) {
  return {
    label: rule.label,
    iconName: rule.iconName,
    iconUrl: resolveIconUrl(rule.iconName),
    singleColorIcon: Boolean(rule.singleColorIcon),
    matchSource,
    regexName: rule.regexName || null,
    ruleDetail: rule.ruleDetail || null,
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

function compileRuleIndex(rules) {
  const index = new Map();

  for (const rule of rules) {
    const typeGroup = index.get(rule.type) || { exact: new Map(), regex: [] };
    const normalizedRule = {
      name: rule.name,
      label: rule.label,
      type: rule.type,
      iconName: rule.iconName,
      singleColorIcon: Boolean(rule.singleColorIcon),
      isRegexRule: Boolean(rule.isRegexRule),
      regexName: rule.regexName || null,
      ruleDetail: rule.ruleDetail || null,
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
