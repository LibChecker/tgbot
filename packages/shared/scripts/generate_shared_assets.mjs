import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(packageDir, "../..");
await run(process.execPath, [resolve(packageDir, "scripts/generate_i18n_catalogs.mjs")], repoDir);
await runPythonScript([
  resolve(packageDir, "scripts/generate_libchecker_bundle.py"),
  ...process.argv.slice(2),
], repoDir);

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
