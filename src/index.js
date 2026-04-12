import { readApkInfo } from "./apk.js";
import { createApkTelegraphPage } from "./telegraph.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const MAX_TELEGRAM_APK_BYTES = 20 * 1024 * 1024;
const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        "Telegram APK info bot is running on Cloudflare Workers. Send Telegram webhook updates to /webhook. Admin endpoints: GET /admin/webhook, POST /admin/webhook/set, POST /admin/webhook/delete.",
        {
          headers: {
            "content-type": "text/plain; charset=UTF-8",
          },
        },
      );
    }

    if (isAdminPath(url.pathname)) {
      return handleAdminRequest(request, env, url);
    }

    if (request.method === "POST" && isWebhookPath(url.pathname)) {
      return handleWebhookRequest(request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleWebhookRequest(request, env, ctx) {
  if (!env.BOT_TOKEN) {
    return new Response("BOT_TOKEN is not configured", { status: 500 });
  }

  if (!isWebhookSecretValid(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  ctx.waitUntil(
    handleUpdate(update, env).catch((error) => {
      console.error("Failed to handle Telegram update", error);
    }),
  );

  return new Response("OK");
}

async function handleAdminRequest(request, env, url) {
  if (!env.BOT_TOKEN) {
    return jsonResponse({ ok: false, error: "BOT_TOKEN is not configured" }, 500);
  }

  if (!env.ADMIN_TOKEN) {
    return jsonResponse(
      { ok: false, error: "ADMIN_TOKEN is not configured for admin endpoints" },
      500,
    );
  }

  if (!isAdminAuthorized(request, env.ADMIN_TOKEN)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/admin/webhook") {
    const info = await telegramApi(env, "getWebhookInfo", {});
    return jsonResponse({
      ok: true,
      webhook_url: info.url || null,
      has_custom_certificate: info.has_custom_certificate || false,
      pending_update_count: info.pending_update_count || 0,
      last_error_date: info.last_error_date || null,
      last_error_message: info.last_error_message || null,
      last_synchronization_error_date: info.last_synchronization_error_date || null,
      max_connections: info.max_connections || null,
      allowed_updates: info.allowed_updates || [],
      ip_address: info.ip_address || null,
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/webhook/set") {
    const payload = await readJsonBody(request);
    const webhookUrl = normalizeWebhookUrl(payload.url) || buildWebhookUrl(url, env);
    const result = await telegramApi(env, "setWebhook", {
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
      drop_pending_updates: Boolean(payload.drop_pending_updates),
    });

    return jsonResponse({
      ok: true,
      action: "setWebhook",
      webhook_url: webhookUrl,
      description: result,
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/webhook/delete") {
    const payload = await readJsonBody(request);
    const result = await telegramApi(env, "deleteWebhook", {
      drop_pending_updates: Boolean(payload.drop_pending_updates),
    });

    return jsonResponse({
      ok: true,
      action: "deleteWebhook",
      description: result,
    });
  }

  return jsonResponse({ ok: false, error: "Not Found" }, 404);
}

async function handleUpdate(update, env) {
  const message = getTelegramMessage(update);
  if (!message?.chat?.id) {
    return;
  }

  const isEdited = Boolean(update.edited_message || update.edited_channel_post);
  const contentText = getMessageContentText(message);
  const command = extractPrimaryCommand(contentText);

  if (command === "start") {
    await sendText(
      env,
      message.chat.id,
      "你好，私聊直接发送或转发 APK 文件我就会自动解析；在群组或频道里也可以直接把 <code>/apkinfo</code> 写在 APK 消息里，或者回复含 APK 的消息发送 <code>/apkinfo</code>。",
      message.message_id,
    );
    return;
  }

  const targetDocument = selectTargetDocument(message, command, isEdited);
  if (!targetDocument) {
    if (command === "apkinfo") {
      await sendText(
        env,
        message.chat.id,
        "我没有找到可解析的 APK。你可以直接发送或转发 APK 文件给我，或者回复含 APK 的消息后发送 <code>/apkinfo</code>。",
        message.message_id,
      );
    }

    return;
  }

  await analyzeApkDocument(env, message, targetDocument);
}

function getTelegramMessage(update) {
  return (
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post ||
    null
  );
}

function selectTargetDocument(message, command, isEdited) {
  const directDocument = getApkDocument(message);
  const repliedDocument = getApkDocument(message.reply_to_message);

  if (command === "apkinfo") {
    return directDocument || repliedDocument;
  }

  if (isEdited) {
    return null;
  }

  if (shouldAutoAnalyzeMessage(message)) {
    return directDocument;
  }

  return null;
}

function shouldAutoAnalyzeMessage(message) {
  const document = getApkDocument(message);
  if (!document) {
    return false;
  }

  return isPrivateChat(message.chat) || isForwardedMessage(message);
}

function getApkDocument(message) {
  if (!message?.document) {
    return null;
  }

  return isApkDocument(message.document) ? message.document : null;
}

async function analyzeApkDocument(env, message, document) {
  if ((document.file_size || 0) > MAX_TELEGRAM_APK_BYTES) {
    await sendText(
      env,
      message.chat.id,
      "这个 APK 超过 Telegram 官方 Bot API 当前可下载的 20MB 限制，Worker 无法直接解析。",
      message.message_id,
    );
    return;
  }

  if (supportsChatAction(message.chat?.type)) {
    await sendChatAction(env, message.chat.id, "typing");
  }

  try {
    const apkBuffer = await downloadTelegramFile(env, document.file_id);
    const apkInfo = await readApkInfo(apkBuffer);
    const report = buildApkReport(message, document, apkInfo);
    const telegraphUrl = await createApkTelegraphPage(env, report);
    await sendText(
      env,
      message.chat.id,
      formatApkSummary(report, telegraphUrl),
      message.message_id,
    );
  } catch (error) {
    console.error("Failed to parse APK", error);
    await sendText(
      env,
      message.chat.id,
      `解析 APK 失败：<code>${escapeHtml(getErrorMessage(error))}</code>`,
      message.message_id,
    );
  }
}

function isWebhookPath(pathname) {
  return pathname === "/" || pathname === "/webhook";
}

function isAdminPath(pathname) {
  return (
    pathname === "/admin/webhook" ||
    pathname === "/admin/webhook/set" ||
    pathname === "/admin/webhook/delete"
  );
}

function isWebhookSecretValid(request, env) {
  const expected = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return true;
  }

  return request.headers.get("X-Telegram-Bot-Api-Secret-Token") === expected;
}

function isAdminAuthorized(request, adminToken) {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length) === adminToken;
  }

  return request.headers.get("x-admin-token") === adminToken;
}

function buildWebhookUrl(url, env) {
  const configured = normalizeWebhookUrl(env.PUBLIC_WEBHOOK_URL);
  if (configured) {
    return configured;
  }

  return `${url.origin}/webhook`;
}

function normalizeWebhookUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/webhook") ? trimmed : `${trimmed.replace(/\/+$/u, "")}/webhook`;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
    },
  });
}

function getMessageContentText(message) {
  return [message?.text, message?.caption].filter(Boolean).join("\n").trim();
}

function extractPrimaryCommand(text) {
  for (const token of extractCommandTokens(text)) {
    if (token === "start" || token === "apkinfo") {
      return token;
    }
  }

  return null;
}

function extractCommandTokens(text) {
  if (!text) {
    return [];
  }

  const matches = text.match(/\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?/gu) || [];
  return matches.map((token) => token.slice(1).split("@")[0].toLowerCase());
}

function isApkDocument(document) {
  const fileName = document.file_name?.toLowerCase() || "";
  const mimeType = document.mime_type?.toLowerCase() || "";
  return fileName.endsWith(".apk") || mimeType.includes("android.package-archive");
}

function isPrivateChat(chat) {
  return chat?.type === "private";
}

function isForwardedMessage(message) {
  return Boolean(
    message?.forward_origin ||
      message?.forward_date ||
      message?.forward_from ||
      message?.forward_from_chat ||
      message?.is_automatic_forward,
  );
}

function supportsChatAction(chatType) {
  return chatType !== "channel";
}

function buildApkReport(message, document, apkInfo) {
  return {
    apkInfo,
    fileName: document.file_name || "unknown.apk",
    fileSizeText: formatBytes(document.file_size || 0),
    sourceLabel: describeMessageSource(message),
    analyzedAt: new Date().toISOString(),
  };
}

function describeMessageSource(message) {
  if (message.chat?.type === "channel") {
    return "频道消息";
  }

  if (isForwardedMessage(message)) {
    return "转发消息";
  }

  if (isPrivateChat(message.chat)) {
    return "私聊消息";
  }

  if (message.chat?.type === "supergroup" || message.chat?.type === "group") {
    return "群组消息";
  }

  return "Telegram 消息";
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  const precision = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[index]}`;
}

async function downloadTelegramFile(env, fileId) {
  const file = await telegramApi(env, "getFile", { file_id: fileId });
  if (!file?.file_path) {
    throw new Error("Telegram 没有返回可下载的 file_path");
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${env.BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) {
    throw new Error(`Telegram 文件下载失败 (${response.status})`);
  }

  return response.arrayBuffer();
}

async function sendText(env, chatId, text, replyToMessageId) {
  await telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_to_message_id: replyToMessageId,
  });
}

async function sendChatAction(env, chatId, action) {
  await telegramApi(env, "sendChatAction", {
    chat_id: chatId,
    action,
  });
}

async function telegramApi(env, method, payload) {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Telegram API ${method} 请求失败 (${response.status})`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} 返回失败`);
  }

  return data.result;
}

function formatApkSummary(report, telegraphUrl) {
  return [
    "<b>APK 解析完成</b>",
    `应用名: <b>${escapeHtml(report.apkInfo.appName)}</b>`,
    `包名: <code>${escapeHtml(report.apkInfo.packageName)}</code>`,
    `versionName: <code>${escapeHtml(report.apkInfo.versionName)}</code>`,
    `versionCode: <code>${escapeHtml(report.apkInfo.versionCode)}</code>`,
    `minSdk: <code>${escapeHtml(report.apkInfo.minSdk)}</code>`,
    `targetSdk: <code>${escapeHtml(report.apkInfo.targetSdk)}</code>`,
    `权限数量: <b>${report.apkInfo.permissions.length}</b>`,
    `原生库数量: <b>${report.apkInfo.nativeLibraries.length}</b>`,
    `四大组件: <b>${countComponents(report.apkInfo.components)}</b>`,
    `meta-data 数量: <b>${countMetaData(report.apkInfo.metaData)}</b>`,
    "",
    `完整报告: <a href="${escapeHtml(telegraphUrl)}">点击查看 Telegraph 页面</a>`,
  ].join("\n");
}

function countComponents(components) {
  return (
    components.activities.length +
    components.services.length +
    components.receivers.length +
    components.providers.length
  );
}

function countMetaData(metaData) {
  return metaData.application.length + metaData.components.length;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "未知错误";
}
