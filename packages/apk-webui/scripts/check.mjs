import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(projectDir, "../..");
const nodeBin = process.execPath;
const sourceRoots = [
  resolve(projectDir, "functions"),
  resolve(projectDir, "scripts"),
  resolve(projectDir, "src"),
];
const extraSyntaxFiles = [
  resolve(projectDir, "vite.config.mjs"),
];

await runNpm(["run", "i18n:check", "--workspace", "@tgbot/shared"], repoDir);

const syntaxFiles = (await collectSyntaxFiles(sourceRoots))
  .concat(extraSyntaxFiles)
  .map((file) => relative(projectDir, file))
  .sort((a, b) => a.localeCompare(b));

for (const file of syntaxFiles) {
  await run(nodeBin, ["--check", file], projectDir);
}

console.log(`Checked ${syntaxFiles.length} WebUI JavaScript files`);

async function collectSyntaxFiles(roots) {
  const files = [];
  for (const root of roots) {
    await collectSyntaxFilesFrom(root, files);
  }
  return files;
}

async function collectSyntaxFilesFrom(dir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      await collectSyntaxFilesFrom(path, files);
      continue;
    }

    if (entry.isFile() && [".js", ".mjs"].includes(extname(entry.name))) {
      files.push(path);
    }
  }
}

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", rejectRun);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`${formatCommand(command, args)} failed with ${signal || `exit code ${code}`}`));
    });
  });
}

function runNpm(args, cwd) {
  if (process.platform !== "win32") {
    return run("npm", args, cwd);
  }

  return run("cmd.exe", ["/d", "/s", "/c", ["npm", ...args].join(" ")], cwd);
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}
