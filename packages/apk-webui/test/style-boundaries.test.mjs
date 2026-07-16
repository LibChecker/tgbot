import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("report and compare styles stay behind lazy module boundaries", async () => {
  const [appCss, reportCss, compareCss, reportRenderer, compareController] = await Promise.all([
    readSource("src/app.css"),
    readSource("src/report.css"),
    readSource("src/compare.css"),
    readSource("src/app/report-renderer.js"),
    readSource("src/app/compare-controller.js"),
  ]);

  const reportOnlySelectors = [
    /^@property --app-title-mask-x\s*\{/mu,
    /^@property --app-title-mask-y\s*\{/mu,
    /^\.report-hero\s*\{/mu,
    /^\.report-share-button__spinner\s*\{/mu,
    /^\.app-title-mask__base(?:,|\s*\{)/mu,
    /^\.native-abi-count\s*\{/mu,
    /^\.component-group-block\s*\{/mu,
    /^\.component-group-grid\s*\{/mu,
    /^\.component-name-prefix\s*\{/mu,
    /^\.component-row-header\s*\{/mu,
    /^\.permission-table-row\s*\{/mu,
    /^\.sdk-row-header\s*\{/mu,
    /^:root\[data-power-mode="constrained"\] \.app-title-mask__color\s*\{/mu,
  ];
  for (const selector of reportOnlySelectors) {
    assert.doesNotMatch(appCss, selector);
    assert.match(reportCss, selector);
  }
  assert.doesNotMatch(appCss, /^\.compare-slot\s*\{/mu);
  assert.match(compareCss, /^\.compare-slot\s*\{/mu);
  assert.match(reportRenderer, /^import "\.\.\/report\.css";/mu);
  assert.match(compareController, /^import "\.\.\/report\.css";/mu);
  assert.match(compareController, /^import "\.\.\/compare\.css";/mu);
  assert.match(reportCss, /^\.group-block\s*\{[^}]*\bpadding:\s*14px;/msu);
  assert.match(reportCss, /^\.component-group-grid\s*\{[^}]*\bgrid-template-columns:\s*1fr;/msu);
  assert.match(reportCss, /^\.permission-table-row\s*\{[^}]*\bgrid-template-columns:\s*minmax\(0,\s*1fr\);/msu);
  assert.doesNotMatch(compareCss, /^\.compare-diff-block\s*\{[^}]*\bpadding:/msu);
});

test("static shell styling stays in stylesheets", async () => {
  const indexHtml = await readSource("src/index.html");
  assert.doesNotMatch(indexHtml, /\sstyle="/u);
});

test("localized action notes can wrap inside the tool panel", async () => {
  const appCss = await readSource("src/app.css");
  const localNoteRule = appCss.match(/^\.local-note\s*\{([^}]*)\}/msu)?.[1] || "";

  assert.match(localNoteRule, /\boverflow-wrap:\s*anywhere;/u);
  assert.match(localNoteRule, /\bwhite-space:\s*normal;/u);
  assert.doesNotMatch(localNoteRule, /\bwhite-space:\s*nowrap;/u);
});
