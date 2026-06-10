import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(projectDir, "dist");

await build({
  configFile: resolve(projectDir, "vite.config.mjs"),
});

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
    "/assets/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n"),
);

await writeFile(resolve(distDir, "_redirects"), "/* /index.html 200\n");

console.log(`Built Cloudflare Pages site at ${distDir}`);
