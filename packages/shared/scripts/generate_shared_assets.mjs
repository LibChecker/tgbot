import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(packageDir, "../..");
const refresh = process.argv.includes("--refresh");
const generatedDir = resolve(packageDir, "src/generated");
const libcheckerOutputs = [
  resolve(generatedDir, "libchecker-rules-core.js"),
  resolve(generatedDir, "libchecker-rules-detail.js"),
  resolve(generatedDir, "libchecker-sdk-icons.js"),
];

await run(process.execPath, [resolve(packageDir, "scripts/generate_i18n_catalogs.mjs")], repoDir);

if (refresh || !(await filesExist(libcheckerOutputs))) {
  await runPythonScript([resolve(packageDir, "scripts/generate_libchecker_bundle.py")], repoDir);
} else {
  console.log("LibChecker generated bundles already exist.");
}

async function filesExist(paths) {
  const results = await Promise.all(paths.map((path) => fileExists(path)));
  return results.every(Boolean);
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runPythonScript(args, cwd) {
  const candidates = process.env.PYTHON ? [process.env.PYTHON] : ["python3", "python"];
  const missing = [];

  for (const command of candidates) {
    try {
      await run(command, args, cwd);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      missing.push(command);
    }
  }

  throw new Error(`Unable to find Python executable. Tried: ${missing.join(", ")}`);
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

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}
