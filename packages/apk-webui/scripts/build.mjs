import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  API_CATALOG_MEDIA_TYPE,
  API_CATALOG_PROFILE,
  ANALYZE_ANDROID_PACKAGE_SKILL,
  createAgentSkillsIndex,
  createApiCatalog,
  createApiDocsMarkdown,
  createAuthMarkdown,
  createOpenApiDocument,
  serializeJson,
} from "../discovery.mjs";
import { DISCOVERY_LINK_HEADER, HOMEPAGE_MARKDOWN } from "../functions/_middleware.js";
import { WEBUI_SITE_ORIGIN } from "../site-config.mjs";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(projectDir, "dist");

await build({
  configFile: resolve(projectDir, "vite.config.mjs"),
});

await disableRocketLoaderForExternalScripts(resolve(distDir, "index.html"));
await copyStableSocialPreview();
await writeSeoFiles();
await writeDiscoveryFiles();

await writeFile(
  resolve(distDir, "_headers"),
  [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    `  Link: ${DISCOVERY_LINK_HEADER}`,
    "",
    "/index.html",
    "  Cache-Control: no-cache",
    "",
    "/social-preview.png",
    "  Cache-Control: public, max-age=3600",
    "",
    "/robots.txt",
    "  Cache-Control: public, max-age=3600",
    "",
    "/sitemap.xml",
    "  Cache-Control: public, max-age=3600",
    "",
    "/index.md",
    "  Content-Type: text/markdown; charset=UTF-8",
    "  Cache-Control: public, max-age=3600",
    "",
    "/auth.md",
    "  Content-Type: text/markdown; charset=UTF-8",
    "  Cache-Control: public, max-age=3600",
    "",
    "/api-docs.md",
    "  Content-Type: text/markdown; charset=UTF-8",
    "  Cache-Control: public, max-age=3600",
    "",
    "/openapi.json",
    "  Content-Type: application/vnd.oai.openapi+json;version=3.1",
    "  Cache-Control: public, max-age=3600",
    "",
    "/.well-known/api-catalog",
    `  Content-Type: ${API_CATALOG_MEDIA_TYPE}; profile="${API_CATALOG_PROFILE}"`,
    "  Cache-Control: public, max-age=3600",
    "",
    "/.well-known/agent-skills/index.json",
    "  Content-Type: application/json; charset=UTF-8",
    "  Cache-Control: public, max-age=3600",
    "",
    "/.well-known/agent-skills/*/SKILL.md",
    "  Content-Type: text/markdown; charset=UTF-8",
    "  Cache-Control: public, max-age=3600",
    "",
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n"),
);

await writeFile(resolve(distDir, "_redirects"), "/* /index.html 200\n");
await writeFile(
  resolve(distDir, "_routes.json"),
  `${JSON.stringify({
    version: 1,
    include: ["/", "/index.html", "/url-report", "/analytics", "/health"],
    exclude: [],
  }, null, 2)}\n`,
);

console.log(`Built Cloudflare Pages site at ${distDir}`);

async function disableRocketLoaderForExternalScripts(indexPath) {
  const html = await readFile(indexPath, "utf8");
  const patched = html.replace(
    /<script\b(?![^>]*\bdata-cfasync=)([^>]*?)\bsrc=/giu,
    '<script data-cfasync="false"$1src=',
  );
  if (patched !== html) {
    await writeFile(indexPath, patched);
  }
}

async function copyStableSocialPreview() {
  await mkdir(distDir, { recursive: true });
  await copyFile(
    resolve(projectDir, "src/assets/social-preview.png"),
    resolve(distDir, "social-preview.png"),
  );
}

async function writeSeoFiles() {
  await writeFile(
    resolve(distDir, "robots.txt"),
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /url-report",
      `Sitemap: ${WEBUI_SITE_ORIGIN}/sitemap.xml`,
      "",
    ].join("\n"),
  );

  await writeFile(
    resolve(distDir, "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url>",
      `    <loc>${WEBUI_SITE_ORIGIN}/</loc>`,
      "    <changefreq>monthly</changefreq>",
      "    <priority>1.0</priority>",
      "  </url>",
      "</urlset>",
      "",
    ].join("\n"),
  );
}

async function writeDiscoveryFiles() {
  await writeFile(resolve(distDir, "index.md"), HOMEPAGE_MARKDOWN);
  await writeFile(resolve(distDir, "auth.md"), createAuthMarkdown(WEBUI_SITE_ORIGIN));
  await writeFile(resolve(distDir, "api-docs.md"), createApiDocsMarkdown(WEBUI_SITE_ORIGIN));
  await writeFile(
    resolve(distDir, "openapi.json"),
    serializeJson(createOpenApiDocument(WEBUI_SITE_ORIGIN)),
  );

  const wellKnownDir = resolve(distDir, ".well-known");
  const skillDir = resolve(wellKnownDir, "agent-skills", ANALYZE_ANDROID_PACKAGE_SKILL.name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    resolve(wellKnownDir, "api-catalog"),
    serializeJson(createApiCatalog(WEBUI_SITE_ORIGIN)),
  );

  const skillSource = await readFile(
    resolve(projectDir, "agent-skills", ANALYZE_ANDROID_PACKAGE_SKILL.name, "SKILL.md"),
  );
  await writeFile(resolve(skillDir, "SKILL.md"), skillSource);
  await writeFile(
    resolve(wellKnownDir, "agent-skills", "index.json"),
    serializeJson(createAgentSkillsIndex(skillSource)),
  );
}
