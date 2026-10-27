import { bindings, defineConfig } from "cf/config";

declare const process: { env: Record<string, string | undefined> };

const sdkEmojiKvNamespaceId = process.env.TELEGRAM_SDK_EMOJI_KV_NAMESPACE_ID;
const sdkEmojiKvBinding = sdkEmojiKvNamespaceId
  ? { SDK_EMOJI_KV: bindings.kv({ id: sdkEmojiKvNamespaceId }) }
  : {};

export default defineConfig((ctx) => {
  switch (ctx.mode) {
    case "preview": {
      return {
        worker: {
          name: "tgbot-preview",
          compatibilityDate: "2026-04-12",
          entrypoint: "src/index.js",
          workersDev: true,
          observability: {
            enabled: true,
            headSamplingRate: 1,
          },
          env: {
            APP_ENV: bindings.text("preview"),
            PUBLIC_WEBHOOK_URL: bindings.text(""),
            WEBUI_SITE_URL: bindings.text(""),
            USAGE_ANALYTICS: bindings.analyticsEngineDataset({
              name: "Libchecker_TG_Bot_Preview",
            }),
            REPORT_DATA_BUCKET: bindings.r2({
              name: "tgbot-preview-report-data",
            }),
            CF_VERSION_METADATA: bindings.versionMetadata(),
            ...sdkEmojiKvBinding,
          },
        },
      };
    }
    case "production": {
      return {
        worker: {
          name: "tgbot",
          compatibilityDate: "2026-04-12",
          entrypoint: "src/index.js",
          workersDev: false,
          observability: {
            enabled: true,
            headSamplingRate: 1,
          },
          env: {
            APP_ENV: bindings.text("production"),
            PUBLIC_WEBHOOK_URL: bindings.text(""),
            WEBUI_SITE_URL: bindings.text(""),
            USAGE_ANALYTICS: bindings.analyticsEngineDataset({
              name: "Libchecker_TG_Bot",
            }),
            REPORT_DATA_BUCKET: bindings.r2({
              name: "tgbot-report-data",
            }),
            CF_VERSION_METADATA: bindings.versionMetadata(),
            ...sdkEmojiKvBinding,
          },
        },
      };
    }
    default: {
      return {
        worker: {
          name: "tgbot",
          compatibilityDate: "2026-04-12",
          entrypoint: "src/index.js",
          workersDev: false,
          observability: {
            enabled: true,
            headSamplingRate: 1,
          },
          env: {
            PUBLIC_WEBHOOK_URL: bindings.text(""),
            WEBUI_SITE_URL: bindings.text(""),
            USAGE_ANALYTICS: bindings.analyticsEngineDataset({
              name: "Libchecker_TG_Bot",
            }),
            REPORT_DATA_BUCKET: bindings.r2({
              name: "tgbot-report-data-dev",
            }),
            CF_VERSION_METADATA: bindings.versionMetadata(),
            ...sdkEmojiKvBinding,
          },
        },
      };
    }
  }
});
