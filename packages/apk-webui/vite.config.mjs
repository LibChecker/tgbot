import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, minify } from "vite";

const projectDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(projectDir, "src");
const sharedDir = resolve(projectDir, "../shared/src");
const packageJson = JSON.parse(readFileSync(resolve(projectDir, "package.json"), "utf8"));

function manualChunks(id) {
  if (id.includes("/packages/shared/src/generated/libchecker-sdk-icons.js")) {
    return "libchecker-sdk-icons";
  }
  if (id.includes("/packages/shared/src/generated/libchecker-rules-core.js")) {
    return "libchecker-rules-core";
  }
  if (id.includes("/packages/shared/src/generated/libchecker-rules-detail.js")) {
    return "libchecker-rules-detail";
  }
  if (id.includes("/packages/shared/src/apk")) {
    return "apk-analyzer";
  }
  return null;
}

export default defineConfig({
  root: srcDir,
  base: "./",
  publicDir: false,
  plugins: [
    pagesFunctionDevProxy(),
    minifyGeneratedJsAssets(),
  ],
  resolve: {
    alias: {
      "@shared": sharedDir,
    },
  },
  define: {
    __APK_WEBUI_VERSION__: JSON.stringify(packageJson.version),
  },
  server: {
    host: "127.0.0.1",
  },
  build: {
    outDir: resolve(projectDir, "dist"),
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    modulePreload: {
      polyfill: false,
    },
    rolldownOptions: {
      input: resolve(srcDir, "index.html"),
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        codeSplitting: true,
        manualChunks,
      },
    },
  },
  worker: {
    format: "es",
    rolldownOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        codeSplitting: true,
        manualChunks,
      },
    },
  },
});

function pagesFunctionDevProxy() {
  return {
    name: "pages-function-dev-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/url-report", async (req, res) => {
        try {
          const { onRequest } = await import("./functions/url-report.js");
          const response = await onRequest({
            request: await createDevRequest(req),
            env: {},
          });
          await sendDevResponse(res, response);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to handle URL report";
          res.statusCode = 500;
          res.setHeader("content-type", "application/json; charset=UTF-8");
          res.end(JSON.stringify({ error: { message } }));
        }
      });
    },
  };
}

async function createDevRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }

  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readDevRequestBody(req);
  return new Request("http://127.0.0.1/url-report", {
    method,
    headers,
    body,
  });
}

async function readDevRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function sendDevResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function minifyGeneratedJsAssets() {
  return {
    name: "minify-generated-js-assets",
    apply: "build",
    async generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (
          asset.type !== "asset" ||
          !/^assets\/libchecker-(?:rules-core|rules-detail|sdk-icons)-.+\.js$/u.test(asset.fileName)
        ) {
          continue;
        }

        const source = typeof asset.source === "string"
          ? asset.source
          : Buffer.from(asset.source).toString("utf8");
        if (!source.includes("Generated from LibChecker-Rules-Bundle")) {
          continue;
        }

        const result = await minify(asset.fileName, source, {
          module: true,
          compress: true,
          mangle: true,
        });
        if (result.errors.length) {
          throw new Error(`Failed to minify ${asset.fileName}: ${result.errors[0].message}`);
        }
        asset.source = result.code;
      }
    },
  };
}
