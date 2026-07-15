import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: fileURLToPath(new URL("./wrangler.toml", import.meta.url)),
        environment: "preview",
      },
      miniflare: {
        bindings: {
          WEBUI_SITE_URL: "https://webui.example.com",
        },
      },
    }),
  ],
  test: {
    include: ["test-runtime/**/*.test.mjs"],
  },
});
