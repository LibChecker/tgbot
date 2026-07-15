interface Env extends Record<string, unknown> {
  ADMIN_TOKEN?: string;
  BOT_TOKEN?: string;
  MAX_LINK_PREVIEW_CD_MB?: string;
  MAX_LINK_PREVIEW_ENTRY_MB?: string;
  MAX_LINK_PREVIEW_RESOURCE_MB?: string;
  MAX_LINK_PREVIEW_TAIL_MB?: string;
  SDK_EMOJI_KV?: KVNamespace;
  TELEGRAM_WEBHOOK_SECRET?: string;
  WEBUI_URL?: string;
}
