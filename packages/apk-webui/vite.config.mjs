import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, minify } from "vite";

const projectDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(projectDir, "src");
const sharedDir = resolve(projectDir, "../shared/src");

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
    minifyGeneratedJsAssets(),
  ],
  resolve: {
    alias: {
      "@shared": sharedDir,
    },
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
