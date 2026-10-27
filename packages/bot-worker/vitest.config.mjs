import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
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
