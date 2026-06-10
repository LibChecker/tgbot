import { readFile, readdir, stat } from "node:fs/promises";
import { relative } from "node:path";
import { gzipSync } from "node:zlib";

const repoDir = new URL("..", import.meta.url);
const distDir = new URL("../packages/apk-webui/dist/", import.meta.url);

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
    maxBytes: 72 * 1024,
    maxGzipBytes: 16 * 1024,
  },
  {
    label: "Analyzer worker",
    pattern: /^assets\/analyzer-worker-[\w-]+\.js$/u,
    maxBytes: 48 * 1024,
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

const assets = await listFiles(distDir);
if (!assets.length) {
  fail("Missing WebUI dist assets. Run `npm run pages:build` before size checks.");
}

const failures = [];
const rows = [];

for (const budget of ASSET_BUDGETS) {
  const matches = assets.filter((asset) => budget.pattern.test(asset.path));
  if (!matches.length) {
    failures.push(`${budget.label}: missing asset matching ${budget.pattern}`);
    continue;
  }

  for (const asset of matches) {
    recordBudgetResult(budget.label, asset.path, asset.bytes, budget.maxBytes);
    if (budget.maxGzipBytes) {
      recordBudgetResult(`${budget.label} gzip`, asset.path, asset.gzipBytes, budget.maxGzipBytes);
    }
  }
}

for (const budget of TOTAL_BUDGETS) {
  const bytes = assets
    .filter(budget.filter)
    .reduce((sum, asset) => sum + asset.bytes, 0);
  recordBudgetResult(budget.label, "(aggregate)", bytes, budget.maxBytes);
}

printRows(rows);

if (failures.length) {
  process.stderr.write(`\nSize budget check failed:\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("\nSize budgets passed.\n");

function recordBudgetResult(label, path, actualBytes, maxBytes) {
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
    const bytes = await readFile(fileUrl);
    results.push({
      path: relative(repoDir.pathname, fileUrl.pathname).replace(/^packages\/apk-webui\/dist\//u, ""),
      bytes: fileStat.size,
      gzipBytes: gzipSync(bytes).byteLength,
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
