import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { annotateSdkMarkers, buildRuleDetailMapKey } from "../src/sdk-markers.js";
import { LIBCHECKER_RULES_CORE } from "../src/generated/libchecker-rules-core.js";
import { LIBCHECKER_RULE_DETAILS } from "../src/generated/libchecker-rules-detail.js";

const python = process.env.PYTHON || "python3";
const generator = fileURLToPath(new URL("../scripts/generate_libchecker_bundle.py", import.meta.url));
const fixtures = JSON.parse(execFileSync(python, [generator, "--matching-fixtures", "--offline"], { encoding: "utf8" }));

function match(rules, name, type, useRegex = true) {
  const components = { activities: [], services: [], receivers: [], providers: [] };
  const apk = { nativeLibraries: [], components, buildFeatures: { nativeValidation: { qihooDetected: true, secneoDetected: true, flutterInjectorDetected: true } } };
  if (type === 0 && useRegex) {
    apk.nativeLibraries = [{ name, abi: "arm64-v8a" }, { name: "libunity.so", abi: "arm64-v8a" }];
  } else {
    const section = { 1: "services", 2: "activities", 3: "receivers", 4: "providers" }[type] || "activities";
    components[section] = [{ name: type === 9 || !useRegex ? "unmatched.component" : name, actions: [name] }];
    if (!useRegex) rules = rules.map((rule) => ({ ...rule, type: 9 }));
  }
  const result = annotateSdkMarkers(apk, () => "", rules, LIBCHECKER_RULE_DETAILS);
  return type === 0 && useRegex ? result.nativeLibraries[0].sdk : Object.values(result.components).flat()[0].sdk;
}

test("the pinned producer's cross-language matching fixtures agree with the real annotator", () => {
  for (const fixture of fixtures.cases) {
    const rules = [...fixture.rules].sort((a, b) => a.priority - b.priority || a.id - b.id)
      .map((rule) => ({ ...rule, label: String(rule.id), iconIndex: -1, iconName: "ic_sdk_placeholder", singleColorIcon: true }));
    const result = match(rules, fixture.input, fixture.type, fixture.useRegex !== false);
    assert.equal(result ? Number(result.label) : null, fixture.expected, fixture.name);
  }
});

test("every generated rule retains its literal lookup, detail identity and supported type", () => {
  for (const rule of LIBCHECKER_RULES_CORE) {
    assert.ok([0, 1, 2, 3, 4, 9].includes(rule.type));
    const result = match(LIBCHECKER_RULES_CORE, rule.name, rule.type);
    assert.equal(result?.label, rule.label, rule.name);
    assert.equal(result?.iconName, rule.iconName, rule.name);
    assert.deepEqual(result?.ruleDetail, LIBCHECKER_RULE_DETAILS[buildRuleDetailMapKey(rule)] || null);
  }
});

test("artifact lock, hash, offline cache, output receipts and trust boundaries", () => {
  execFileSync(python, [fileURLToPath(new URL("./test_rules_artifact.py", import.meta.url))], { stdio: "pipe", env: { ...process.env, NODE: process.execPath } });
});
