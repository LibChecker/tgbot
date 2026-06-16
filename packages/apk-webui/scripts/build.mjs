import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(projectDir, "dist");
const siteUrl = "https://lc.absinthe.life";

await build({
  configFile: resolve(projectDir, "vite.config.mjs"),
});

await disableRocketLoaderForExternalScripts(resolve(distDir, "index.html"));
await copyStableSocialPreview();
await writeSeoFiles();

await writeFile(
  resolve(distDir, "_headers"),
  [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
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
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n"),
);

await writeFile(resolve(distDir, "_redirects"), "/* /index.html 200\n");

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
      `Sitemap: ${siteUrl}/sitemap.xml`,
      "",
    ].join("\n"),
  );

  await writeFile(
    resolve(distDir, "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url>",
      `    <loc>${siteUrl}/</loc>`,
      "    <changefreq>monthly</changefreq>",
      "    <priority>1.0</priority>",
      "  </url>",
      "</urlset>",
      "",
    ].join("\n"),
  );
}
