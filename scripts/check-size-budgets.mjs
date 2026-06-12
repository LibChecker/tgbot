import { readFile, readdir, stat } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoDir = new URL("..", import.meta.url);
const repoPath = fileURLToPath(repoDir);
const distDir = new URL("../packages/apk-webui/dist/", import.meta.url);

const FIRST_SCREEN_MAX_REQUESTS = 5;
const FIRST_SCREEN_JS_GZIP_BUDGET = 36 * 1024;
const GENERATED_MATERIALIZED_MIN_BYTES = 10 * 1024;
const GENERATED_WRAPPER_MAX_BYTES = 2 * 1024;

const ASSET_BUDGETS = [
  {
    label: "WebUI HTML",
    pattern: /^index\.html$/u,
    maxBytes: 24 * 1024,
    maxGzipBytes: 6 * 1024,
  },
  {
    label: "WebUI entry JS",
    pattern: /^assets\/index-[\w-]+\.js$/u,
    maxBytes: 128 * 1024,
    maxGzipBytes: 36 * 1024,
  },
  {
    label: "WebUI CSS",
    pattern: /^assets\/index-[\w-]+\.css$/u,
    maxBytes: 80 * 1024,
    maxGzipBytes: 16 * 1024,
  },
  {
    label: "Analyzer worker",
    pattern: /^assets\/analyzer-worker-[\w-]+\.js$/u,
    maxBytes: 48 * 1024,
    maxGzipBytes: 13 * 1024,
  },
  {
    label: "APK analyzer chunk",
    pattern: /^assets\/apk-analyzer-[\w-]+\.js$/u,
    maxBytes: 84 * 1024,
  },
  {
    label: "SDK marker chunk",
    pattern: /^assets\/sdk-markers-[\w-]+\.js$/u,
    maxBytes: 8 * 1024,
  },
  {
    label: "SDK icon renderer chunk",
    pattern: /^assets\/sdk-icon-renderer-[\w-]+\.js$/u,
    maxBytes: 8 * 1024,
    maxGzipBytes: 3 * 1024,
  },
  {
    label: "LCApps reader chunk",
    pattern: /^assets\/lcapps-reader-[\w-]+\.js$/u,
    maxBytes: 16 * 1024,
    maxGzipBytes: 5 * 1024,
  },
  {
    label: "LibChecker rules core chunk",
    pattern: /^assets\/libchecker-rules-core-[\w-]+\.js$/u,
    maxBytes: 540 * 1024,
  },
  {
    label: "LibChecker rules detail chunk",
    pattern: /^assets\/libchecker-rules-detail-[\w-]+\.js$/u,
    maxBytes: 2_700 * 1024,
  },
  {
    label: "LibChecker SDK icons chunk",
    pattern: /^assets\/libchecker-sdk-icons-[\w-]+\.js$/u,
    maxBytes: 520 * 1024,
  },
];

const GENERATED_CHUNK_GROUPS = [
  {
    label: "LibChecker rules core materialized chunk",
    pattern: /^assets\/libchecker-rules-core-[\w-]+\.js$/u,
  },
  {
    label: "LibChecker rules detail materialized chunk",
    pattern: /^assets\/libchecker-rules-detail-[\w-]+\.js$/u,
  },
  {
    label: "LibChecker SDK icons materialized chunk",
    pattern: /^assets\/libchecker-sdk-icons-[\w-]+\.js$/u,
  },
];

const TOTAL_BUDGETS = [
  {
    label: "WebUI JS total",
    filter: (asset) => asset.path.endsWith(".js"),
    maxBytes: 3_700 * 1024,
  },
  {
    label: "WebUI dist total",
    filter: () => true,
    maxBytes: 4_100 * 1024,
  },
];

const FIRST_SCREEN_FORBIDDEN_PATTERNS = [
  /^assets\/analyzer-worker-/u,
  /^assets\/apk-analyzer-/u,
  /^assets\/compare-controller-/u,
  /^assets\/lcapps-reader-/u,
  /^assets\/libchecker-/u,
  /^assets\/sdk-icon-cache-/u,
  /^assets\/sdk-icon-renderer-/u,
  /^assets\/sdk-markers-/u,
];

const WORKER_FORBIDDEN_REFERENCES = [
  "libchecker-rules-detail",
  "sdk-icon-cache",
  "compare-controller",
];

const GENERATED_PAYLOAD_MARKERS = [
  "LIBCHECKER_RULES_CORE=",
  "LIBCHECKER_RULE_DETAILS=",
  "LIBCHECKER_SDK_ICON_SVGS=",
];

const assets = await listFiles(distDir);
if (!assets.length) {
  fail("Missing WebUI dist assets. Run `npm run pages:build` before performance budget checks.");
}

const assetsByPath = new Map(assets.map((asset) => [asset.path, asset]));
const failures = [];
const rows = [];

checkAssetBudgets();
checkFirstScreenBudget();
checkWorkerBudget();
checkGeneratedChunkDuplication();
checkGeneratedPayloadInlining();
checkTotalBudgets();

printRows(rows);

if (failures.length) {
  process.stderr.write(`\nPerformance budget check failed:\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("\nPerformance budgets passed.\n");

function checkAssetBudgets() {
  for (const budget of ASSET_BUDGETS) {
    const matches = assets.filter((asset) => budget.pattern.test(asset.path));
    if (!matches.length) {
      failures.push(`${budget.label}: missing asset matching ${budget.pattern}`);
      continue;
    }

    for (const asset of matches) {
      recordBytesBudgetResult(budget.label, asset.path, asset.bytes, budget.maxBytes);
      if (budget.maxGzipBytes) {
        recordBytesBudgetResult(`${budget.label} gzip`, asset.path, asset.gzipBytes, budget.maxGzipBytes);
      }
    }
  }
}

function checkFirstScreenBudget() {
  const htmlAsset = assetsByPath.get("index.html");
  if (!htmlAsset) {
    failures.push("First-screen request count: missing index.html");
    return;
  }

  const firstScreenResources = collectFirstScreenResources(htmlAsset.text);
  recordCountBudgetResult(
    "First-screen request count",
    "(unique document/resources)",
    firstScreenResources.length,
    FIRST_SCREEN_MAX_REQUESTS,
  );

  const missingResources = firstScreenResources
    .filter((path) => path !== "index.html")
    .filter((path) => !assetsByPath.has(path));
  for (const path of missingResources) {
    failures.push(`First-screen resource ${path} is referenced by index.html but missing from dist`);
  }

  const forbiddenResources = firstScreenResources.filter((path) => (
    FIRST_SCREEN_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(path))
  ));
  for (const path of forbiddenResources) {
    failures.push(`First-screen resource ${path} should remain lazy-loaded`);
  }

  const firstScreenJsGzipBytes = firstScreenResources
    .filter((path) => path.endsWith(".js"))
    .map((path) => assetsByPath.get(path))
    .filter(Boolean)
    .reduce((sum, asset) => sum + asset.gzipBytes, 0);
  recordBytesBudgetResult(
    "First-screen JS gzip",
    "(initial scripts)",
    firstScreenJsGzipBytes,
    FIRST_SCREEN_JS_GZIP_BUDGET,
  );
}

function checkWorkerBudget() {
  const workerAssets = assets.filter((asset) => /^assets\/analyzer-worker-[\w-]+\.js$/u.test(asset.path));
  if (workerAssets.length !== 1) {
    failures.push(`Analyzer worker entry: expected 1 worker asset, found ${workerAssets.length}`);
    return;
  }

  const worker = workerAssets[0];
  for (const reference of WORKER_FORBIDDEN_REFERENCES) {
    if (worker.text.includes(reference)) {
      failures.push(`Analyzer worker entry references ${reference}; keep it out of the worker startup path`);
    }
  }
}

function checkGeneratedChunkDuplication() {
  for (const group of GENERATED_CHUNK_GROUPS) {
    const matches = assets.filter((asset) => group.pattern.test(asset.path));
    const materialized = matches.filter((asset) => asset.bytes >= GENERATED_MATERIALIZED_MIN_BYTES);
    const oversizedWrappers = matches.filter((asset) => (
      asset.bytes < GENERATED_MATERIALIZED_MIN_BYTES &&
      asset.bytes > GENERATED_WRAPPER_MAX_BYTES
    ));

    recordCountBudgetResult(group.label, "(materialized chunks)", materialized.length, 1);

    if (materialized.length !== 1) {
      failures.push(`${group.label}: expected exactly 1 materialized chunk, found ${materialized.length}`);
    }
    for (const asset of oversizedWrappers) {
      failures.push(`${group.label}: wrapper ${asset.path} is ${formatBytes(asset.bytes)}, expected <= ${formatBytes(GENERATED_WRAPPER_MAX_BYTES)}`);
    }
  }
}

function checkGeneratedPayloadInlining() {
  const generatedPayloadAssets = new Set(
    GENERATED_CHUNK_GROUPS.flatMap((group) => (
      assets
        .filter((asset) => group.pattern.test(asset.path) && asset.bytes >= GENERATED_MATERIALIZED_MIN_BYTES)
        .map((asset) => asset.path)
    )),
  );

  for (const asset of assets.filter((item) => item.path.endsWith(".js"))) {
    if (generatedPayloadAssets.has(asset.path)) {
      continue;
    }

    for (const marker of GENERATED_PAYLOAD_MARKERS) {
      if (asset.text.includes(marker)) {
        failures.push(`Generated payload marker ${marker} was inlined into ${asset.path}`);
      }
    }
  }
}

function checkTotalBudgets() {
  for (const budget of TOTAL_BUDGETS) {
    const bytes = assets
      .filter(budget.filter)
      .reduce((sum, asset) => sum + asset.bytes, 0);
    recordBytesBudgetResult(budget.label, "(aggregate)", bytes, budget.maxBytes);
  }
}

function collectFirstScreenResources(html) {
  const resources = new Set(["index.html"]);
  const tagPattern = /<(script|link|img)\b[^>]*>/giu;
  let match;

  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    if (tagName === "script") {
      addResource(resources, readAttribute(tag, "src"));
      continue;
    }

    if (tagName === "img") {
      addResource(resources, readAttribute(tag, "src"));
      continue;
    }

    const rel = readAttribute(tag, "rel").toLowerCase();
    if (/\b(?:stylesheet|modulepreload|preload|icon|apple-touch-icon)\b/u.test(rel)) {
      addResource(resources, readAttribute(tag, "href"));
    }
  }

  return [...resources].sort();
}

function addResource(resources, value) {
  const normalized = normalizeDistResourcePath(value);
  if (normalized) {
    resources.add(normalized);
  }
}

function normalizeDistResourcePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /^(?:[a-z]+:)?\/\//iu.test(trimmed) || trimmed.startsWith("data:")) {
    return "";
  }

  return trimmed
    .replace(/^\.?\//u, "")
    .replace(/^packages\/apk-webui\/dist\//u, "")
    .split(/[?#]/u)[0];
}

function readAttribute(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu");
  const match = tag.match(pattern);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function recordBytesBudgetResult(label, path, actualBytes, maxBytes) {
  const over = actualBytes > maxBytes;
  rows.push({
    label,
    path,
    actual: formatBytes(actualBytes),
    budget: formatBytes(maxBytes),
    status: over ? "FAIL" : "OK",
  });
  if (over) {
    failures.push(`${label}: ${path} is ${formatBytes(actualBytes)} over ${formatBytes(maxBytes)}`);
  }
}

function recordCountBudgetResult(label, path, actualCount, maxCount) {
  const over = actualCount > maxCount;
  rows.push({
    label,
    path,
    actual: String(actualCount),
    budget: String(maxCount),
    status: over ? "FAIL" : "OK",
  });
  if (over) {
    failures.push(`${label}: ${path} is ${actualCount}, budget is ${maxCount}`);
  }
}

async function listFiles(rootUrl, dirUrl = rootUrl) {
  const dirents = await readdir(dirUrl, { withFileTypes: true });
  const results = [];

  for (const dirent of dirents) {
    const fileUrl = new URL(`${dirent.name}${dirent.isDirectory() ? "/" : ""}`, dirUrl);
    if (dirent.isDirectory()) {
      results.push(...await listFiles(rootUrl, fileUrl));
      continue;
    }

    const fileStat = await stat(fileUrl);
    const buffer = await readFile(fileUrl);
    const path = relative(repoPath, fileURLToPath(fileUrl))
      .replace(/\\/gu, "/")
      .replace(/^packages\/apk-webui\/dist\//u, "");
    results.push({
      path,
      bytes: fileStat.size,
      gzipBytes: gzipSync(buffer).byteLength,
      text: path.endsWith(".js") || path.endsWith(".html") ? buffer.toString("utf8") : "",
    });
  }

  return results;
}

function printRows(items) {
  const columns = [
    ["Check", "label"],
    ["Asset", "path"],
    ["Actual", "actual"],
    ["Budget", "budget"],
    ["Status", "status"],
  ];
  const widths = columns.map(([header, key]) => (
    Math.max(header.length, ...items.map((item) => String(item[key]).length))
  ));

  process.stdout.write(`${columns.map(([header], index) => header.padEnd(widths[index])).join("  ")}\n`);
  process.stdout.write(`${widths.map((width) => "-".repeat(width)).join("  ")}\n`);
  for (const item of items) {
    process.stdout.write(`${columns.map(([, key], index) => String(item[key]).padEnd(widths[index])).join("  ")}\n`);
  }
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
