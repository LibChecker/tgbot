import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerConfigPath = resolve(repoDir, "packages/bot-worker/wrangler.toml");
const webuiDir = resolve(repoDir, "packages/apk-webui");
const webuiDistDir = resolve(webuiDir, "dist");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const wranglerBin = resolve(repoDir, "node_modules/.bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");

const WORKER_UPLOAD_BUDGET_KIB = 5_500;
const WORKER_UPLOAD_GZIP_BUDGET_KIB = 900;

process.on("unhandledRejection", (error) => {
  fail(error instanceof Error ? error.message : String(error));
});

const TARGETS = {
  preview: {
    workerEnv: "preview",
    pagesBranch: resolvePreviewBranch(),
  },
  production: {
    workerEnv: "production",
    pagesBranch: "main",
  },
};

const options = parseArgs(process.argv.slice(2));
const targetName = String(options.target || options._[0] || "preview").toLowerCase();
const target = TARGETS[targetName];

if (!target) {
  fail(`Unknown deploy target "${targetName}". Use "preview" or "production".`);
}

if (!existsSync(wranglerBin)) {
  fail("Missing local Wrangler binary. Run `npm install` first.");
}

if (!options["skip-preflight"]) {
  await run(npmBin, ["run", "check"]);
  await run(npmBin, ["run", "pages:build"]);
  await run(npmBin, ["run", "perf:check"]);
  await runWorkerDryRun(target.workerEnv);
}

if (options["preflight-only"]) {
  process.stdout.write(`Cloudflare ${targetName} preflight passed.\n`);
  process.exit(0);
}

requireDeployEnvironment(targetName);

if (!options["pages-only"]) {
  await run(wranglerBin, [
    "deploy",
    "--config",
    workerConfigPath,
    "--env",
    target.workerEnv,
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
    "--project-name=tgbot-apk-webui",
    `--branch=${target.pagesBranch}`,
  ], { cwd: webuiDir });
}

process.stdout.write(`Cloudflare ${targetName} deploy finished.\n`);

async function runWorkerDryRun(workerEnv) {
  const output = await run(wranglerBin, [
    "deploy",
    "--config",
    workerConfigPath,
    "--env",
    workerEnv,
    "--dry-run",
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

function requireDeployEnvironment(targetNameValue) {
  const required = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
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

  const githubBranch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  if (githubBranch) {
    return sanitizePagesBranch(githubBranch);
  }

  const currentBranch = runSync("git", ["branch", "--show-current"]).trim();
  if (currentBranch) {
    return sanitizePagesBranch(currentBranch);
  }

  return "preview";
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
      env: process.env,
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
        resolveRun(output);
        return;
      }
      rejectRun(new Error(`${formatCommand(command, args)} failed with ${signal || `exit code ${code}`}`));
    });
  });
}

function runSync(command, args) {
  const spawnSpec = resolveSpawnSpec(command, args);
  const result = spawnSync(spawnSpec.command, spawnSpec.args, {
    cwd: repoDir,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout : "";
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

function parseArgs(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }

    const normalized = token.slice(2);
    const equalIndex = normalized.indexOf("=");
    if (equalIndex >= 0) {
      parsed[normalized.slice(0, equalIndex)] = normalized.slice(equalIndex + 1);
      continue;
    }

    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[normalized] = true;
      continue;
    }

    parsed[normalized] = next;
    index += 1;
  }
  return parsed;
}

function formatCommand(command, args) {
  const executable = command === wranglerBin ? basename(command) : command;
  return [executable, ...args].join(" ");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
