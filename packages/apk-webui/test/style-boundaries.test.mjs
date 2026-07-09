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

  assert.doesNotMatch(appCss, /^\.report-hero\s*\{/mu);
  assert.doesNotMatch(appCss, /^\.compare-slot\s*\{/mu);
  assert.match(reportCss, /^\.report-hero\s*\{/mu);
  assert.match(compareCss, /^\.compare-slot\s*\{/mu);
  assert.match(reportRenderer, /^import "\.\.\/report\.css";/mu);
  assert.match(compareController, /^import "\.\.\/report\.css";/mu);
  assert.match(compareController, /^import "\.\.\/compare\.css";/mu);
  assert.match(reportCss, /^\.group-block\s*\{[^}]*\bpadding:\s*14px;/msu);
  assert.doesNotMatch(compareCss, /^\.compare-diff-block\s*\{[^}]*\bpadding:/msu);
});

test("static shell styling stays in stylesheets", async () => {
  const indexHtml = await readSource("src/index.html");
  assert.doesNotMatch(indexHtml, /\sstyle="/u);
});
