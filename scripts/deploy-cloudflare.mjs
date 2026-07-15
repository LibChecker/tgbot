import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repoDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerConfigPath = resolve(repoDir, "packages/bot-worker/wrangler.toml");
const webuiDir = resolve(repoDir, "packages/apk-webui");
const webuiDistDir = resolve(webuiDir, "dist");
const pagesProjectName = "tgbot-apk-webui";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const wranglerBin = resolve(repoDir, "node_modules/.bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
const DEFAULT_SDK_EMOJI_KV_NAMESPACE_TITLE = "tgbot-sdk-emojis";
const DEFAULT_REPORT_DATA_BUCKET_NAMES = {
  preview: "tgbot-preview-report-data",
  production: "tgbot-report-data",
};
const DEFAULT_PREVIEW_PAGES_BRANCH = "preview";
let activeWorkerConfigPath = workerConfigPath;
let temporaryWorkerConfigPath = null;

const WORKER_UPLOAD_BUDGET_KIB = 5_500;
const WORKER_UPLOAD_GZIP_BUDGET_KIB = 900;

process.on("unhandledRejection", (error) => {
  fail(error instanceof Error ? error.message : String(error));
});
process.on("exit", cleanupTemporaryWorkerConfig);

const previewPagesBranch = resolvePreviewBranch();

const TARGETS = {
  preview: {
    workerEnv: "preview",
    pagesBranch: previewPagesBranch,
    workerUrl: normalizeOptionalUrl(process.env.PREVIEW_WORKER_URL, "PREVIEW_WORKER_URL"),
    webuiUrl: resolvePreviewWebUiUrl(previewPagesBranch),
    reportDataBucketName: DEFAULT_REPORT_DATA_BUCKET_NAMES.preview,
  },
  production: {
    workerEnv: "production",
    pagesBranch: "main",
    workerUrl: normalizeOptionalUrl(process.env.WORKER_URL, "WORKER_URL"),
    webuiUrl: normalizeOptionalUrl(process.env.WEBUI_SITE_URL, "WEBUI_SITE_URL"),
    reportDataBucketName: DEFAULT_REPORT_DATA_BUCKET_NAMES.production,
  },
};

const { values: options, positionals: targetArgs } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    target: { type: "string" },
    "skip-preflight": { type: "boolean" },
    "preflight-only": { type: "boolean" },
    "worker-only": { type: "boolean" },
    "pages-only": { type: "boolean" },
  },
});
const targetName = String(options.target || targetArgs[0] || "preview").toLowerCase();
const target = TARGETS[targetName];

if (!target) {
  fail(`Unknown deploy target "${targetName}". Use "preview" or "production".`);
}

if (!existsSync(wranglerBin)) {
  fail("Missing local Wrangler binary. Run `npm install` first.");
}

activeWorkerConfigPath = await prepareWorkerConfig(target);

if (!options["skip-preflight"]) {
  await run(npmBin, ["run", "check"]);
  await run(npmBin, ["run", "pages:build"], { env: buildWebUiBuildEnv(target) });
  await run(npmBin, ["run", "perf:check"]);
  await runWorkerDryRun(target);
}

if (options["preflight-only"]) {
  process.stdout.write(`Cloudflare ${targetName} preflight passed.\n`);
  process.exit(0);
}

if (options["skip-preflight"]) {
  if (!options["worker-only"]) {
    await run(npmBin, ["run", "pages:build"], { env: buildWebUiBuildEnv(target) });
  } else if (!options["pages-only"]) {
    await run(npmBin, ["run", "generated:generate"]);
  }
}

requireDeployEnvironment(targetName, target);

if (!options["pages-only"]) {
  await ensureReportDataBucket(target);
  await run(wranglerBin, [
    "deploy",
    "--config",
    activeWorkerConfigPath,
    "--env",
    target.workerEnv,
    ...buildWorkerDeployArgs(target),
  ]);
}

if (!options["worker-only"]) {
  if (!existsSync(webuiDistDir)) {
    fail("Missing WebUI dist directory. Run `npm run pages:build` before deploy.");
  }
  await run(wranglerBin, [
    "pages",
    "deploy",
    "dist",
    `--project-name=${pagesProjectName}`,
    `--branch=${target.pagesBranch}`,
  ], { cwd: webuiDir });
  await ensurePagesCustomDomain(target);
}

process.stdout.write(`Cloudflare ${targetName} deploy finished.\n`);

async function ensureReportDataBucket(targetValue) {
  const bucketName = normalizeText(targetValue.reportDataBucketName);
  if (!bucketName) {
    return;
  }

  if (await reportDataBucketExists(bucketName)) {
    process.stdout.write(`Report data R2 bucket already exists: ${bucketName}\n`);
    return;
  }

  const result = await run(wranglerBin, [
    "r2",
    "bucket",
    "create",
    bucketName,
  ], { capture: true, allowFailure: true });

  if (result.ok) {
    process.stdout.write(`Ensured report data R2 bucket: ${bucketName}\n`);
    return;
  }

  if (/\[code:\s*10004\]|already (?:exists|own)|bucket.+already/iu.test(result.output)) {
    process.stdout.write(`Report data R2 bucket already exists: ${bucketName}\n`);
    return;
  }

  fail(`Failed to ensure report data R2 bucket ${bucketName}.`);
}

async function reportDataBucketExists(bucketName) {
  try {
    const result = await cloudflareApi(
      `/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/r2/buckets`,
      { fatal: false },
    );
    const buckets = Array.isArray(result?.buckets) ? result.buckets : [];
    return buckets.some((bucket) => bucket?.name === bucketName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unable to list R2 buckets before create: ${message}\n`);
    return false;
  }
}

async function prepareWorkerConfig(targetValue) {
  const namespaceId = await resolveSdkEmojiKvNamespaceId({ create: !options["preflight-only"] });
  if (!namespaceId) {
    return workerConfigPath;
  }

  const configText = await readFile(workerConfigPath, "utf8");
  temporaryWorkerConfigPath = resolve(repoDir, "packages/bot-worker", `wrangler.generated.${process.pid}.toml`);
  await writeFile(
    temporaryWorkerConfigPath,
    `${configText.trimEnd()}\n\n[[env.${targetValue.workerEnv}.kv_namespaces]]\nbinding = "SDK_EMOJI_KV"\nid = "${escapeTomlString(namespaceId)}"\n`,
    "utf8",
  );
  process.stdout.write(`Using SDK emoji KV namespace for ${targetValue.workerEnv}: ${namespaceId}\n`);
  return temporaryWorkerConfigPath;
}

async function resolveSdkEmojiKvNamespaceId({ create }) {
  const explicitNamespaceId = normalizeText(process.env.TELEGRAM_SDK_EMOJI_KV_NAMESPACE_ID);
  if (explicitNamespaceId) {
    return explicitNamespaceId;
  }

  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    return "";
  }

  const title = normalizeText(
    process.env.TELEGRAM_SDK_EMOJI_KV_NAMESPACE_TITLE
      || process.env.TELEGRAM_SDK_EMOJI_KV_NAMESPACE_NAME,
  ) || DEFAULT_SDK_EMOJI_KV_NAMESPACE_TITLE;
  let existingNamespaceId = "";
  try {
    existingNamespaceId = await findKvNamespaceId(title);
  } catch (error) {
    process.stderr.write(`Skipping SDK emoji KV binding: ${error instanceof Error ? error.message : String(error)}\n`);
    return "";
  }
  if (existingNamespaceId) {
    return existingNamespaceId;
  }
  if (!create) {
    return "";
  }

  let namespace;
  try {
    namespace = await cloudflareApi(
      `/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/storage/kv/namespaces`,
      {
        method: "POST",
        body: JSON.stringify({ title }),
        fatal: false,
      },
    );
  } catch (error) {
    process.stderr.write(`Skipping SDK emoji KV binding: ${error instanceof Error ? error.message : String(error)}\n`);
    return "";
  }
  const namespaceId = normalizeText(namespace?.id);
  if (!namespaceId) {
    fail(`Cloudflare KV namespace ${title} was created without an id in the API response.`);
  }
  process.stdout.write(`Created SDK emoji KV namespace: ${title} (${namespaceId})\n`);
  return namespaceId;
}

async function findKvNamespaceId(title) {
  for (let page = 1; page <= 100; page += 1) {
    const namespaces = await cloudflareApi(
      `/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/storage/kv/namespaces?per_page=100&page=${page}`,
      { fatal: false },
    );
    const match = (namespaces || []).find((namespace) => namespace?.title === title);
    if (match?.id) {
      return match.id;
    }
    if (!Array.isArray(namespaces) || namespaces.length < 100) {
      break;
    }
  }
  return "";
}

async function runWorkerDryRun(targetValue) {
  const output = await run(wranglerBin, [
    "deploy",
    "--config",
    activeWorkerConfigPath,
    "--env",
    targetValue.workerEnv,
    "--dry-run",
    ...buildWorkerDeployArgs(targetValue),
  ], { capture: true });

  const match = output.match(/Total Upload:\s+([\d.]+)\s+KiB\s+\/\s+gzip:\s+([\d.]+)\s+KiB/u);
  if (!match) {
    fail("Unable to read Worker dry-run upload size from Wrangler output.");
  }

  const uploadKiB = Number(match[1]);
  const gzipKiB = Number(match[2]);
  const failures = [];
  if (uploadKiB > WORKER_UPLOAD_BUDGET_KIB) {
    failures.push(`Worker upload ${uploadKiB.toFixed(2)} KiB exceeds ${WORKER_UPLOAD_BUDGET_KIB} KiB`);
  }
  if (gzipKiB > WORKER_UPLOAD_GZIP_BUDGET_KIB) {
    failures.push(`Worker gzip upload ${gzipKiB.toFixed(2)} KiB exceeds ${WORKER_UPLOAD_GZIP_BUDGET_KIB} KiB`);
  }
  if (failures.length) {
    fail(`Worker size budget failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }

  process.stdout.write(
    `Worker size budget passed: ${uploadKiB.toFixed(2)} KiB / gzip ${gzipKiB.toFixed(2)} KiB.\n`,
  );
}

function buildWorkerDeployArgs(targetValue) {
  const args = [];
  if (targetValue.workerUrl) {
    args.push(
      "--domain",
      targetValue.workerUrl.hostname,
      "--var",
      `PUBLIC_WEBHOOK_URL:${targetValue.workerUrl.origin}`,
    );
  }

  if (targetValue.webuiUrl) {
    args.push(
      "--var",
      `WEBUI_SITE_URL:${targetValue.webuiUrl.origin}`,
    );
  }

  return args;
}

function buildWebUiBuildEnv(targetValue) {
  const env = {};

  if (targetValue.webuiUrl) {
    env.WEBUI_SITE_ORIGIN = targetValue.webuiUrl.origin;
    env.WEBUI_SITE_URL = targetValue.webuiUrl.origin;
  }

  if (targetValue.workerUrl) {
    env.BOT_REPORT_DATA_ORIGIN = targetValue.workerUrl.origin;
  }

  return env;
}

async function ensurePagesCustomDomain(targetValue) {
  if (!targetValue.webuiUrl || targetValue.webuiUrl.hostname.endsWith(".pages.dev")) {
    return;
  }

  const hostname = targetValue.webuiUrl.hostname;
  const domains = await cloudflareApi(
    `/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(pagesProjectName)}/domains`,
  );

  if ((domains || []).some((domain) => domain?.name === hostname)) {
    process.stdout.write(`Pages custom domain already registered: ${hostname}\n`);
    return;
  }

  const domain = await cloudflareApi(
    `/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(pagesProjectName)}/domains`,
    {
      method: "POST",
      body: JSON.stringify({ name: hostname }),
    },
  );
  process.stdout.write(`Registered Pages custom domain: ${domain?.name || hostname}\n`);
  logPagesCustomDomainDnsHint(targetValue, hostname);
}

function logPagesCustomDomainDnsHint(targetValue, hostname) {
  if (targetValue.workerEnv !== "preview") {
    return;
  }

  const projectHostname = `${pagesProjectName}.pages.dev`;
  if (hostname === projectHostname) {
    return;
  }

  const previewAlias = `${toPagesPreviewAlias(targetValue.pagesBranch)}.${projectHostname}`;
  process.stdout.write(
    `Preview Pages alias: https://${previewAlias}\n`,
  );
  process.stdout.write(
    `Pages custom domain DNS target: ${hostname} CNAME ${projectHostname} (proxied)\n`,
  );
}

async function cloudflareApi(pathname, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    const message = data?.errors?.map((error) => error.message).filter(Boolean).join("; ")
      || `HTTP ${response.status}`;
    if (options.fatal === false) {
      throw new Error(`Cloudflare API request failed: ${message}`);
    }
    fail(`Cloudflare API request failed: ${message}`);
  }
  return data.result;
}

function resolvePreviewWebUiUrl(pagesBranch) {
  const configured = normalizeOptionalUrl(process.env.PREVIEW_WEBUI_SITE_URL, "PREVIEW_WEBUI_SITE_URL");
  if (configured) {
    return configured;
  }

  return new URL(`https://${toPagesPreviewAlias(pagesBranch)}.${pagesProjectName}.pages.dev`);
}

function toPagesPreviewAlias(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "preview";
}

function normalizeOptionalUrl(value, envName) {
  if (!value) {
    return undefined;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${envName} must be an HTTPS origin URL, for example https://example.com`);
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
    fail(`${envName} must be an HTTPS origin URL, for example https://example.com`);
  }
  return url;
}

function normalizeText(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "";
}

function escapeTomlString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function cleanupTemporaryWorkerConfig() {
  if (temporaryWorkerConfigPath) {
    rmSync(temporaryWorkerConfigPath, { force: true });
  }
}

function requireDeployEnvironment(targetNameValue, targetValue) {
  const required = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
  if (!targetValue.workerUrl) {
    required.push(targetNameValue === "preview" ? "PREVIEW_WORKER_URL" : "WORKER_URL");
  }
  if (!targetValue.webuiUrl) {
    required.push(targetNameValue === "preview" ? "PREVIEW_WEBUI_SITE_URL" : "WEBUI_SITE_URL");
  }
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    fail(`Missing Cloudflare deploy environment for ${targetNameValue}: ${missing.join(", ")}`);
  }
}

function resolvePreviewBranch() {
  const explicit = process.env.CF_PAGES_BRANCH || process.env.PAGES_BRANCH;
  if (explicit) {
    return sanitizePagesBranch(explicit);
  }

  return DEFAULT_PREVIEW_PAGES_BRANCH;
}

function sanitizePagesBranch(value) {
  const normalized = String(value)
    .trim()
    .replace(/^refs\/heads\//u, "")
    .replace(/[^a-zA-Z0-9._/-]+/gu, "-")
    .replace(/^[-/]+|[-/]+$/gu, "");
  return normalized || "preview";
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const spawnSpec = resolveSpawnSpec(command, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: options.cwd || repoDir,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";

    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stderr.write(text);
      });
    }

    child.on("error", rejectRun);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolveRun(options.allowFailure ? { ok: true, output, code, signal } : output);
        return;
      }
      if (options.allowFailure) {
        resolveRun({ ok: false, output, code, signal });
        return;
      }
      rejectRun(new Error(`${formatCommand(command, args)} failed with ${signal || `exit code ${code}`}`));
    });
  });
}

function resolveSpawnSpec(command, args) {
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/iu.test(command)) {
    return { command, args };
  }

  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", [command, ...args].map(quoteWindowsCommandArg).join(" ")],
  };
}

function quoteWindowsCommandArg(value) {
  const text = String(value);
  if (!/[ \t"&|<>^]/u.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function formatCommand(command, args) {
  const executable = command === wranglerBin ? basename(command) : command;
  return [executable, ...args].join(" ");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
