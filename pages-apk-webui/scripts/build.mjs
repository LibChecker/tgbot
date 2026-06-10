import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(projectDir, "..");
const srcDir = resolve(projectDir, "src");
const distDir = resolve(projectDir, "dist");
const moduleDir = resolve(distDir, "modules");
const generatedDir = resolve(moduleDir, "generated");
const assetsDir = resolve(distDir, "assets");
const appModuleDir = resolve(distDir, "app");

const staticFiles = [
  ["app.css", "app.css"],
  ["app.js", "app.js"],
  ["analyzer-worker.js", "analyzer-worker.js"],
  ["app/analytics.js", "app/analytics.js"],
  ["app/analytics-fields.js", "app/analytics-fields.js"],
  ["app/app-title-effects.js", "app/app-title-effects.js"],
  ["app/html.js", "app/html.js"],
  ["app/i18n.js", "app/i18n.js"],
  ["app/math.js", "app/math.js"],
  ["app/format.js", "app/format.js"],
  ["app/report-model.js", "app/report-model.js"],
  ["app/history.js", "app/history.js"],
  ["app/compare-controller.js", "app/compare-controller.js"],
  ["app/sdk-icon-cache.js", "app/sdk-icon-cache.js"],
  ["app/sdk-icon-renderer.js", "app/sdk-icon-renderer.js"],
  ["app/system.js", "app/system.js"],
  ["app/title-effects.js", "app/title-effects.js"],
  ["assets/icon_round.svg", "assets/icon_round.svg"],
];

const sharedModules = [
  ["src/shared/apk.js", "modules/apk.js"],
  ["src/shared/apk-signatures.js", "modules/apk-signatures.js"],
  ["src/shared/i18n.js", "modules/i18n.js"],
  ["src/shared/sdk-markers.js", "modules/sdk-markers.js"],
  ["src/shared/terminal-system.js", "modules/terminal-system.js"],
  ["src/shared/generated/i18n-catalogs.js", "modules/generated/i18n-catalogs.js"],
  ["src/shared/generated/libchecker-rules.js", "modules/generated/libchecker-rules.js"],
  ["src/shared/generated/libchecker-sdk-icons.js", "modules/generated/libchecker-sdk-icons.js"],
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(moduleDir, { recursive: true });
await mkdir(generatedDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });
await mkdir(appModuleDir, { recursive: true });

const buildVersion = createHash("sha256")
  .update(await readVersionedSource(staticFiles, srcDir))
  .update(await readVersionedSource(sharedModules, repoDir))
  .digest("hex")
  .slice(0, 12);

for (const [from, to] of staticFiles) {
  await copyStaticFile(resolve(srcDir, from), resolve(distDir, to), buildVersion);
}

const indexHtml = await readFile(resolve(srcDir, "index.html"), "utf8");
await writeFile(
  resolve(distDir, "index.html"),
  indexHtml.replaceAll("__BUILD_VERSION__", `v=${buildVersion}`),
);

for (const [from, to] of sharedModules) {
  await copyStaticFile(resolve(repoDir, from), resolve(distDir, to), buildVersion);
}

await writeFile(
  resolve(distDir, "_headers"),
  [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "",
    "/modules/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/app/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/app.js",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/analyzer-worker.js",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/app.css",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n"),
);

await writeFile(resolve(distDir, "_redirects"), "/* /index.html 200\n");

console.log(`Built Cloudflare Pages site at ${distDir}`);

async function readVersionedSource(files, rootDir) {
  const chunks = [];
  for (const [from] of files) {
    if (!from.endsWith(".css") && !from.endsWith(".js")) {
      continue;
    }
    chunks.push(await readFile(resolve(rootDir, from)));
  }

  return Buffer.concat(chunks);
}

async function copyStaticFile(from, to, buildVersion) {
  if (!from.endsWith(".js")) {
    await copyFile(from, to);
    return;
  }

  const source = await readFile(from, "utf8");
  await writeFile(to, versionJsImports(source, buildVersion));
}

function versionJsImports(source, buildVersion) {
  const version = `v=${buildVersion}`;
  return source
    .replace(
      /(from\s+["']|import\(\s*["'])(\.{1,2}\/[^"']+\.js)(["'])/gu,
      (_, prefix, specifier, suffix) => `${prefix}${appendVersion(specifier, version)}${suffix}`,
    )
    .replace(
      /new URL\(\s*["'](\.\/[^"']+\.js)(["']\s*,\s*import\.meta\.url\s*\))/gu,
      (_, specifier, suffix) => `new URL("${appendVersion(specifier, version)}${suffix}`,
    );
}

function appendVersion(specifier, version) {
  if (specifier.includes("?")) {
    return `${specifier}&${version}`;
  }

  return `${specifier}?${version}`;
}
