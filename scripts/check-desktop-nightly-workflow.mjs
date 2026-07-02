import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = resolve(repoDir, ".github/workflows/desktop-nightly.yml");

await access(workflowPath).catch(() => {
  fail("Missing .github/workflows/desktop-nightly.yml");
});

const workflow = await readFile(workflowPath, "utf8");

const requiredSnippets = [
  ["manual trigger", "workflow_dispatch:"],
  ["scheduled trigger", "schedule:"],
  ["release write permission", "contents: write"],
  ["Windows runner", "windows-latest"],
  ["macOS Apple Silicon runner", "macos-15"],
  ["site config URL fallback", "site-config.mjs"],
  ["repository URL override", "WEBUI_SITE_URL_OVERRIDE"],
  ["macOS arm64 guard", 'test "$(uname -m)" = "arm64"'],
  ["Pake CLI invocation", "pake-cli@"],
  ["Windows x64 target", '"x64"'],
  ["macOS Apple Silicon target", "--targets apple"],
  ["reusable nightly tag", "git tag -f nightly"],
  ["nightly release creation", "gh release create nightly"],
  ["nightly release upload", "gh release upload nightly"],
  ["asset replacement", "--clobber"],
  ["not latest release", "--latest=false"],
  ["Windows artifact", "libchecker-webui-windows-x64.msi"],
  ["macOS artifact", "libchecker-webui-macos-arm64.dmg"],
];

for (const [label, snippet] of requiredSnippets) {
  if (!workflow.includes(snippet)) {
    fail(`Desktop nightly workflow missing ${label}: ${snippet}`);
  }
}

const cacheActionVersions = Array.from(
  workflow.matchAll(/uses:\s+actions\/cache@v(\d+)(?:\s|$)/g),
  (match) => Number(match[1]),
);

if (cacheActionVersions.length === 0) {
  fail("Desktop nightly workflow missing Node 24-compatible cache action: actions/cache@v5 or newer");
}

const unsupportedCacheVersions = cacheActionVersions.filter((version) => version < 5);
if (unsupportedCacheVersions.length > 0) {
  const versions = unsupportedCacheVersions.map((version) => `v${version}`).join(", ");
  fail(`Desktop nightly workflow uses unsupported actions/cache version(s): ${versions}`);
}

console.log("Checked desktop nightly workflow");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
