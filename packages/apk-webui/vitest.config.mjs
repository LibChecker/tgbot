import { fileURLToPath } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
      },
      miniflare: {
        serviceBindings: {
          ASSETS: () => new Response("Not Found", { status: 404 }),
        },
      },
    }),
  ],
  test: {
    include: ["test-runtime/**/*.test.mjs"],
  },
});
