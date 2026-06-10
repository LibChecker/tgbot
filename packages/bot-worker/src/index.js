import { readAndroidPackageInfo } from "../../shared/src/apk.js";
import { assertTelegramApkReport } from "../../shared/src/contracts.js";
import { buildFeatureIconUrl, buildSdkIconUrl, handleIconRequest } from "./icons.js";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, createI18n, normalizeLocale, resolveTelegramLocale } from "./i18n.js";
import {
  createRequestTelemetryContext,
  extendTelemetryContext,
  logErrorEvent,
  logInfoEvent,
  logWarnEvent,
} from "./observability.js";
import { createSdkMarkerAnnotator } from "../../shared/src/sdk-markers.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const MAX_TELEGRAM_APK_BYTES = 20 * 1024 * 1024;
const DEFAULT_DIRECT_UPLOAD_BYTES = 90 * 1024 * 1024;
const ANDROID_PACKAGE_EXTENSIONS = [".apk", ".apks", ".apkm", ".xapk"];
const JSON_CONTENT_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
};
const TEXT_CONTENT_HEADERS = {
  "content-type": "text/plain; charset=UTF-8",
};
const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
];
const MANAGED_COMMAND_LANGUAGE_CODES = [null, ...SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE)];

let cachedBotIdentity = null;
let apkUrlPreviewModulePromise = null;
let reportViewerModulePromise = null;
let sdkRuleAnnotatorPromise = null;
let telegraphModulePromise = null;
let uploadViewModulePromise = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const telemetry = createRequestTelemetryContext(request, url, env);

    const iconResponse = handleIconRequest(url.pathname);
    if (iconResponse) {
      return await iconResponse;
    }

    if (request.method === "GET" && url.pathname === "/") {
      logInfoEvent(env, telemetry, "worker.status_viewed", {
        result: "success",
        http_status: 200,
      });
      return new Response(
        "Telegram APK info bot is running on Cloudflare Workers. Send Telegram webhook updates to /webhook. Admin endpoints: GET /admin/webhook, POST /admin/webhook/set, POST /admin/webhook/delete.",
        {
          headers: TEXT_CONTENT_HEADERS,
        },
      );
    }

    if (request.method === "GET" && url.pathname === "/report") {
      const startedAt = Date.now();
      const reportPath = url.searchParams.get("path") || null;
      const { handleReportRequest } = await loadReportViewerModule();
      const response = await handleReportRequest(url, env);
      const logFields = {
        result: response.ok ? "success" : "error",
        http_status: response.status,
        report_path: reportPath,
        duration_ms: Date.now() - startedAt,
      };

      if (response.ok) {
        logInfoEvent(env, telemetry, "report.viewed", logFields);
      } else {
        logWarnEvent(env, telemetry, "report.view_failed", logFields);
      }

      return response;
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/upload") {
      return handleUploadRequest(request, env, url, telemetry);
    }

    if (isAdminPath(url.pathname)) {
      return handleAdminRequest(request, env, url, telemetry);
    }

    if (request.method === "POST" && isWebhookPath(url.pathname)) {
      return handleWebhookRequest(request, env, ctx, url.origin, telemetry);
    }

    logWarnEvent(
      env,
      telemetry,
      "worker.route_not_found",
      {
        result: "not_found",
        http_status: 404,
      },
      { analytics: false },
    );

    return new Response("Not Found", { status: 404 });
  },
};

async function handleWebhookRequest(request, env, ctx, requestOrigin, telemetry) {
  if (!env.BOT_TOKEN) {
    logErrorEvent(
      env,
      telemetry,
      "webhook.misconfigured",
      {
        result: "missing_bot_token",
        http_status: 500,
      },
      { analytics: false },
    );
    return new Response("BOT_TOKEN is not configured", { status: 500 });
  }

  if (!isWebhookSecretValid(request, env)) {
    logWarnEvent(
      env,
      telemetry,
      "webhook.unauthorized",
      {
        result: "invalid_secret",
        http_status: 401,
      },
      { analytics: false },
    );
    return new Response("Unauthorized", { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    logWarnEvent(
      env,
      telemetry,
      "webhook.bad_request",
      {
        result: "invalid_json",
        http_status: 400,
      },
      { analytics: false },
    );
    return new Response("Bad Request", { status: 400 });
  }

  const updateTelemetry = extendTelemetryContext(telemetry, {
    update_type: getUpdateType(update),
  });

  logInfoEvent(env, updateTelemetry, "webhook.accepted", {
    result: "accepted",
    http_status: 200,
  });

  ctx.waitUntil(
    handleUpdate(update, env, requestOrigin, updateTelemetry).catch((error) => {
      logErrorEvent(env, updateTelemetry, "telegram.update.unhandled_error", {
        result: "error",
        error_name: getErrorName(error),
        error_message: getErrorMessage(error),
        error_stack: getErrorStack(error),
      });
    }),
  );

  return new Response("OK");
}

async function handleAdminRequest(request, env, url, telemetry) {
  if (!env.BOT_TOKEN) {
    logErrorEvent(
      env,
      telemetry,
      "admin.misconfigured",
      {
        admin_action: url.pathname,
        result: "missing_bot_token",
        http_status: 500,
      },
      { analytics: false },
    );
    return jsonResponse({ ok: false, error: "BOT_TOKEN is not configured" }, 500);
  }

  if (!env.ADMIN_TOKEN) {
    logErrorEvent(
      env,
      telemetry,
      "admin.misconfigured",
      {
        admin_action: url.pathname,
        result: "missing_admin_token",
        http_status: 500,
      },
      { analytics: false },
    );
    return jsonResponse(
      { ok: false, error: "ADMIN_TOKEN is not configured for admin endpoints" },
      500,
    );
  }

  if (!isAdminAuthorized(request, env.ADMIN_TOKEN)) {
    logWarnEvent(
      env,
      telemetry,
      "admin.unauthorized",
      {
        admin_action: url.pathname,
        result: "unauthorized",
        http_status: 401,
      },
      { analytics: false },
    );
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  if (request.method === "GET" && url.pathname === "/admin/webhook") {
    const info = await telegramApi(env, "getWebhookInfo", {});
    logInfoEvent(env, telemetry, "admin.webhook.info", {
      admin_action: "webhook_info",
      result: "success",
      http_status: 200,
      webhook_url: info.url || null,
      pending_update_count: info.pending_update_count || 0,
    });
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

    logInfoEvent(env, telemetry, "admin.webhook.set", {
      admin_action: "webhook_set",
      result: "success",
      http_status: 200,
      webhook_url: webhookUrl,
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

    logInfoEvent(env, telemetry, "admin.webhook.delete", {
      admin_action: "webhook_delete",
      result: "success",
      http_status: 200,
      drop_pending_updates: Boolean(payload.drop_pending_updates),
    });

    return jsonResponse({
      ok: true,
      action: "deleteWebhook",
      description: result,
    });
  }

  if (request.method === "GET" && url.pathname === "/admin/commands") {
    const commandTargets = getManagedCommandTargets();
    const commandsByScope = {};

    for (const target of commandTargets) {
      const scopeKey = getCommandScopeKey(target.scope, target.languageCode);
      const commands = await telegramApi(env, "getMyCommands", {
        scope: target.scope,
        language_code: target.languageCode || undefined,
      });
      commandsByScope[scopeKey] = commands;
    }

    logInfoEvent(env, telemetry, "admin.commands.info", {
      admin_action: "commands_info",
      result: "success",
      http_status: 200,
      scope_count: commandTargets.length,
    });

    return jsonResponse({
      ok: true,
      commands: commandsByScope,
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/commands/set") {
    const payload = await readJsonBody(request);
    const customCommands = normalizeBotCommands(payload.commands);
    const commandTargets = getManagedCommandTargets();

    for (const target of commandTargets) {
      const commands = customCommands || getLocalizedBotCommands(target.languageCode);
      await telegramApi(env, "setMyCommands", {
        scope: target.scope,
        language_code: target.languageCode || undefined,
        commands,
      });
    }

    logInfoEvent(env, telemetry, "admin.commands.set", {
      admin_action: "commands_set",
      result: "success",
      http_status: 200,
      scope_count: commandTargets.length,
      command_count: (customCommands || getLocalizedBotCommands()).length,
    });

    return jsonResponse({
      ok: true,
      action: "setMyCommands",
      scopes: commandTargets.map((target) => getCommandScopeKey(target.scope, target.languageCode)),
      commands: customCommands || getLocalizedBotCommands(),
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/commands/delete") {
    const commandTargets = getManagedCommandTargets();

    for (const target of commandTargets) {
      await telegramApi(env, "deleteMyCommands", {
        scope: target.scope,
        language_code: target.languageCode || undefined,
      });
    }

    logInfoEvent(env, telemetry, "admin.commands.delete", {
      admin_action: "commands_delete",
      result: "success",
      http_status: 200,
      scope_count: commandTargets.length,
    });

    return jsonResponse({
      ok: true,
      action: "deleteMyCommands",
      scopes: commandTargets.map((target) => getCommandScopeKey(target.scope, target.languageCode)),
    });
  }

  logWarnEvent(
    env,
    telemetry,
    "admin.route_not_found",
    {
      admin_action: url.pathname,
      result: "not_found",
      http_status: 404,
    },
    { analytics: false },
  );
  return jsonResponse({ ok: false, error: "Not Found" }, 404);
}

async function handleUploadRequest(request, env, url, telemetry) {
  const locale = normalizeUploadLocale(url.searchParams.get("lang"));
  const publicBaseUrl = resolvePublicBaseUrl(env, url.origin);
  const uploadUrl = buildUploadUrl(publicBaseUrl, locale);
  const maxUploadBytes = getMaxDirectUploadBytes(env);
  const maxSizeText = formatBytes(maxUploadBytes);

  if (request.method === "GET") {
    logInfoEvent(env, telemetry, "upload.page_viewed", {
      result: "success",
      http_status: 200,
    });
    return renderUploadResponse({ locale, uploadUrl, maxSizeText });
  }

  const startedAt = Date.now();
  let activeLocale = locale;
  let activeUploadUrl = uploadUrl;

  try {
    const formData = await request.formData();
    const formLocale = normalizeUploadLocale(formData.get("lang") || locale);
    activeLocale = formLocale;
    const formI18n = createI18n(formLocale);
    const apkFile = formData.get("apk");
    const formUploadUrl = buildUploadUrl(publicBaseUrl, formLocale);
    activeUploadUrl = formUploadUrl;

    if (!isUploadFile(apkFile)) {
      logWarnEvent(env, telemetry, "upload.analysis.rejected", {
        result: "missing_file",
        http_status: 400,
      });
      return renderUploadResponse(
        {
          locale: formLocale,
          uploadUrl: formUploadUrl,
          maxSizeText,
          error: formI18n.t("upload.choose_file"),
        },
        400,
      );
    }

    if (!isUploadedApkFile(apkFile)) {
      logWarnEvent(env, telemetry, "upload.analysis.rejected", {
        result: "invalid_file",
        http_status: 400,
        file_name: apkFile.name || null,
        file_size_bytes: apkFile.size || 0,
      });
      return renderUploadResponse(
        {
          locale: formLocale,
          uploadUrl: formUploadUrl,
          maxSizeText,
          error: formI18n.t("upload.invalid_file"),
        },
        400,
      );
    }

    if ((apkFile.size || 0) > maxUploadBytes) {
      logWarnEvent(env, telemetry, "upload.analysis.skipped_too_large", {
        result: "too_large",
        file_name: apkFile.name || null,
        file_size_bytes: apkFile.size || 0,
      });
      return renderUploadResponse(
        {
          locale: formLocale,
          uploadUrl: formUploadUrl,
          maxSizeText,
          error: formI18n.t("upload.too_large", { maxSize: maxSizeText }),
        },
        413,
      );
    }

    logInfoEvent(env, telemetry, "upload.analysis.started", {
      result: "started",
      file_name: apkFile.name || null,
      file_size_bytes: apkFile.size || 0,
    });

    const sdkRuleAnnotatorTask = loadSdkRuleAnnotator();
    const telegraphModuleTask = loadTelegraphModule();
    const apkBuffer = await apkFile.arrayBuffer();
    const apkInfo = await readAndroidPackageInfo(apkBuffer);
    const report = await buildApkReport(
      buildWebUploadMessage(formLocale),
      buildUploadDocument(apkFile),
      apkInfo,
      publicBaseUrl,
      formLocale,
      sdkRuleAnnotatorTask,
    );
    const { createApkTelegraphPage } = await telegraphModuleTask;
    const telegraphPage = await createApkTelegraphPage(env, report);
    const reportUrl = buildReportViewerUrl(publicBaseUrl, telegraphPage.path, formLocale);

    logInfoEvent(env, telemetry, "upload.analysis.succeeded", {
      result: "success",
      duration_ms: Date.now() - startedAt,
      file_name: apkFile.name || null,
      file_size_bytes: apkFile.size || 0,
      package_name: report.apkInfo.packageName,
      permissions_count: report.apkInfo.permissions.length,
      native_library_count: report.apkInfo.nativeLibraries.length,
      component_count: countComponents(report.apkInfo.components),
      meta_data_count: countMetaData(report.apkInfo.metaData),
      sdk_native_match_count: report.apkInfo.sdkSummary?.native.length || 0,
      sdk_component_match_count: report.apkInfo.sdkSummary?.components.length || 0,
      has_app_icon: Boolean(report.apkInfo.icon?.dataUri),
      app_icon_path: report.apkInfo.icon?.path || null,
      report_path: telegraphPage.path || null,
      ...getArchiveTelemetryFields(report.apkInfo),
    });

    return new Response(null, {
      status: 303,
      headers: {
        location: reportUrl,
      },
    });
  } catch (error) {
    logErrorEvent(env, telemetry, "upload.analysis.failed", {
      result: "error",
      duration_ms: Date.now() - startedAt,
      error_name: getErrorName(error),
      error_message: getErrorMessage(error),
      error_stack: getErrorStack(error),
    });

    return renderUploadResponse(
      {
        locale: activeLocale,
        uploadUrl: activeUploadUrl,
        maxSizeText,
        error: createI18n(activeLocale).t("upload.parse_failed", {
          message: getLocalizedErrorMessage(error, activeLocale),
        }),
      },
      500,
    );
  }
}

async function handleUpdate(update, env, requestOrigin, telemetry) {
  const message = getTelegramMessage(update);
  if (!message?.chat?.id) {
    logInfoEvent(
      env,
      telemetry,
      "telegram.update.ignored",
      {
        result: "missing_chat",
      },
      { analytics: false },
    );
    return;
  }

  const isEdited = Boolean(update.edited_message || update.edited_channel_post);
  const contentText = getMessageContentText(message);
  const command = extractPrimaryCommand(contentText);
  const locale = resolveTelegramLocale(message);
  const { t } = createI18n(locale);
  const botIdentity = await getBotIdentity(env);
  const botMentioned = isBotMentioned(message, botIdentity);
  const updateTelemetry = extendTelemetryContext(
    telemetry,
    buildMessageTelemetryFields(update, message, command, botMentioned, locale),
  );

  logInfoEvent(env, updateTelemetry, "telegram.update.received", {
    result: "received",
    content_length: contentText.length,
  });

  if (command === "start") {
    await sendText(
      env,
      message.chat.id,
      t("bot.start"),
      message.message_id,
    );
    logInfoEvent(env, updateTelemetry, "command.start.responded", {
      result: "success",
    });
    return;
  }

  if (command === "upload") {
    const publicBaseUrl = resolvePublicBaseUrl(env, requestOrigin);
    const uploadUrl = buildUploadUrl(publicBaseUrl, locale);
    await sendText(
      env,
      message.chat.id,
      t("bot.upload_entry"),
      message.message_id,
      buildLinkReplyMarkup(message.chat, uploadUrl, t("bot.open_upload_page")),
    );
    logInfoEvent(env, updateTelemetry, "command.upload.responded", {
      result: "success",
    });
    return;
  }

  let targetDocument = selectTargetDocument(message, command, isEdited, botMentioned);
  if (!targetDocument && (command === "apkinfo" || botMentioned)) {
    targetDocument = await recoverReferencedDocument(env, message, updateTelemetry);
  }

  const targetUrl = targetDocument ? null : selectTargetUrl(message, command, isEdited, botMentioned);

  if (!targetDocument && !targetUrl) {
    if (command === "apkinfo" || botMentioned) {
      logWarnEvent(env, updateTelemetry, "apk.target_missing", {
        result: "missing_target_document",
        has_related_document: Boolean(findRelatedDocument(message, getRawDocument)),
        has_related_url: Boolean(findRelatedUrl(message)),
      });
      await sendText(
        env,
        message.chat.id,
        t("bot.apk_not_found"),
        message.message_id,
      );
    }

    return;
  }

  if (targetUrl) {
    logInfoEvent(
      env,
      updateTelemetry,
      "apk.target_resolved",
      {
        result: "resolved_url",
        url_host: safeUrlHost(targetUrl),
        url_path: safeUrlPath(targetUrl),
      },
      { analytics: false },
    );

    await analyzeApkUrl(env, message, targetUrl, requestOrigin, updateTelemetry, locale);
    return;
  }

  logInfoEvent(
    env,
    updateTelemetry,
    "apk.target_resolved",
    {
      result: "resolved",
      file_name: targetDocument.file_name || null,
      file_size_bytes: targetDocument.file_size || 0,
      has_apk_document: isApkDocument(targetDocument),
    },
    { analytics: false },
  );

  await analyzeApkDocument(env, message, targetDocument, requestOrigin, updateTelemetry, locale);
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

function selectTargetDocument(message, command, isEdited, botMentioned) {
  const directDocument = getApkDocument(message);
  const relatedDocument = findRelatedApkDocument(message);
  const rawDirectDocument = getRawDocument(message);
  const rawRelatedDocument = findRelatedDocument(message, getRawDocument);

  if (command === "apkinfo" || botMentioned) {
    return directDocument || relatedDocument || rawDirectDocument || rawRelatedDocument;
  }

  if (isEdited) {
    return null;
  }

  if (shouldAutoAnalyzeMessage(message)) {
    return directDocument || getForwardedDocumentFallback(message, rawDirectDocument);
  }

  return null;
}

function selectTargetUrl(message, command, isEdited, botMentioned) {
  const directLinks = extractLinksFromMessage(message);
  const relatedLink = findRelatedUrl(message);

  if (command === "apkinfo" || botMentioned) {
    return directLinks[0] || relatedLink;
  }

  if (isEdited) {
    return null;
  }

  const directApkLink = directLinks.find(isLikelyApkUrl);
  if (directApkLink) {
    return directApkLink;
  }

  if (isPrivateChat(message.chat)) {
    return directLinks[0] || null;
  }

  return null;
}

function shouldAutoAnalyzeMessage(message) {
  const document = getApkDocument(message);
  if (!document) {
    return false;
  }

  return isPrivateChat(message.chat) || isGroupOrChannelChat(message.chat) || isForwardedMessage(message);
}

function getApkDocument(message) {
  if (!message?.document) {
    return null;
  }

  return isApkDocument(message.document) ? message.document : null;
}

function getRawDocument(message) {
  return message?.document || null;
}

function getExternalReplyApkDocument(message) {
  if (!message?.external_reply?.document) {
    return null;
  }

  return isApkDocument(message.external_reply.document) ? message.external_reply.document : null;
}

function findRelatedApkDocument(message, visited = new Set()) {
  return findRelatedDocument(message, getApkDocument, visited);
}

function findRelatedUrl(message, visited = new Set()) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const messageId =
    message.message_id != null
      ? `${message.chat?.id || "chat"}:${message.message_id}`
      : null;

  if (messageId) {
    if (visited.has(messageId)) {
      return null;
    }
    visited.add(messageId);
  }

  const links = extractLinksFromMessage(message);
  if (links.length > 0) {
    return links[0];
  }

  if (message.external_reply) {
    const externalReplyLink = findRelatedUrl(message.external_reply, visited);
    if (externalReplyLink) {
      return externalReplyLink;
    }
  }

  return findRelatedUrl(message.reply_to_message, visited);
}

function findRelatedDocument(message, extractor, visited = new Set()) {
  if (!message || typeof message !== "object") {
    return null;
  }

  const messageId =
    message.message_id != null
      ? `${message.chat?.id || "chat"}:${message.message_id}`
      : null;

  if (messageId) {
    if (visited.has(messageId)) {
      return null;
    }
    visited.add(messageId);
  }

  const externalReplyDocument = getExternalReplyDocument(message, extractor);
  if (externalReplyDocument) {
    return externalReplyDocument;
  }

  const repliedDocument = extractor(message.reply_to_message);
  if (repliedDocument) {
    return repliedDocument;
  }

  return findRelatedDocument(message.reply_to_message, extractor, visited);
}

function getForwardedDocumentFallback(message, rawDocument) {
  if (!rawDocument) {
    return null;
  }

  if (message?.is_automatic_forward || isForwardedMessage(message)) {
    return rawDocument;
  }

  return null;
}

async function recoverReferencedDocument(env, message, telemetry) {
  const candidates = collectReferencedMessageCandidates(message);
  if (candidates.length > 0) {
    logInfoEvent(
      env,
      telemetry,
      "apk.reference_recovery_attempted",
      {
        result: "attempted",
        recovery_candidate_count: candidates.length,
      },
      { analytics: false },
    );
  }

  for (const candidate of candidates) {
    const recovered = await forwardMessageForDocument(env, message, candidate, telemetry);
    if (recovered) {
      logInfoEvent(
        env,
        telemetry,
        "apk.reference_recovery_succeeded",
        {
          result: "success",
          file_name: recovered.file_name || null,
          file_size_bytes: recovered.file_size || 0,
        },
        { analytics: false },
      );
      return recovered;
    }
  }

  if (candidates.length > 0) {
    logWarnEvent(
      env,
      telemetry,
      "apk.reference_recovery_failed",
      {
        result: "failed",
        recovery_candidate_count: candidates.length,
      },
      { analytics: false },
    );
  }

  return null;
}

function collectReferencedMessageCandidates(message) {
  const candidates = [];

  if (message?.reply_to_message?.message_id && message?.chat?.id) {
    candidates.push({
      fromChatId: message.chat.id,
      messageId: message.reply_to_message.message_id,
      threadId: message.message_thread_id || null,
    });
  }

  if (message?.external_reply?.chat?.id && message?.external_reply?.message_id) {
    candidates.push({
      fromChatId: message.external_reply.chat.id,
      messageId: message.external_reply.message_id,
      threadId: message.message_thread_id || null,
    });
  }

  return candidates;
}

async function forwardMessageForDocument(env, message, candidate, telemetry) {
  try {
    const forwarded = await telegramApi(env, "forwardMessage", {
      chat_id: message.chat.id,
      from_chat_id: candidate.fromChatId,
      message_id: candidate.messageId,
      disable_notification: true,
      message_thread_id: candidate.threadId || undefined,
    });

    try {
      return getRawDocument(forwarded);
    } finally {
      await deleteTelegramMessage(env, message.chat.id, forwarded?.message_id);
    }
  } catch (error) {
    logWarnEvent(
      env,
      telemetry,
      "apk.reference_recovery_forward_failed",
      {
        result: "forward_failed",
        candidate_chat_id: String(candidate.fromChatId),
        candidate_message_id: candidate.messageId,
        error_name: getErrorName(error),
        error_message: getErrorMessage(error),
      },
      { analytics: false },
    );
    return null;
  }
}

async function deleteTelegramMessage(env, chatId, messageId) {
  if (!chatId || !messageId) {
    return;
  }

  try {
    await telegramApi(env, "deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (error) {
    logWarnEvent(env, { surface: "worker", route: "telegram_api" }, "telegram.message_delete.failed", {
      command: "deleteMessage",
      result: "error",
      error_name: getErrorName(error),
    });
  }
}

function getExternalReplyDocument(message, extractor) {
  if (!message?.external_reply) {
    return null;
  }

  return extractor(message.external_reply);
}

async function analyzeApkDocument(env, message, document, requestOrigin, telemetry, locale) {
  const startedAt = Date.now();
  const { t } = createI18n(locale);
  const publicBaseUrl = resolvePublicBaseUrl(env, requestOrigin);

  if ((document.file_size || 0) > MAX_TELEGRAM_APK_BYTES) {
    logWarnEvent(env, telemetry, "apk.analysis.skipped_too_large", {
      result: "too_large",
      file_name: document.file_name || null,
      file_size_bytes: document.file_size || 0,
    });
    await sendText(
      env,
      message.chat.id,
      t("bot.apk_too_large"),
      message.message_id,
      buildLinkReplyMarkup(
        message.chat,
        buildUploadUrl(publicBaseUrl, locale),
        t("bot.open_upload_page"),
      ),
    );
    return;
  }

  if (supportsChatAction(message.chat?.type)) {
    await sendChatAction(env, message.chat.id, "typing");
  }

  logInfoEvent(
    env,
    telemetry,
    "apk.analysis.started",
    {
      result: "started",
      file_name: document.file_name || null,
      file_size_bytes: document.file_size || 0,
    },
  );

  try {
    const sdkRuleAnnotatorTask = loadSdkRuleAnnotator();
    const telegraphModuleTask = loadTelegraphModule();
    const apkBuffer = await downloadTelegramFile(env, document.file_id, locale);
    const apkInfo = await readAndroidPackageInfo(apkBuffer);
    const report = await buildApkReport(
      message,
      document,
      apkInfo,
      publicBaseUrl,
      locale,
      sdkRuleAnnotatorTask,
    );
    const { createApkTelegraphPage } = await telegraphModuleTask;
    const telegraphPage = await createApkTelegraphPage(env, report);
    const reportUrl = buildReportViewerUrl(publicBaseUrl, telegraphPage.path, locale);

    logInfoEvent(env, telemetry, "apk.analysis.succeeded", {
      result: "success",
      duration_ms: Date.now() - startedAt,
      file_name: document.file_name || null,
      file_size_bytes: document.file_size || 0,
      package_name: report.apkInfo.packageName,
      version_name: report.apkInfo.versionName,
      permissions_count: report.apkInfo.permissions.length,
      native_library_count: report.apkInfo.nativeLibraries.length,
      component_count: countComponents(report.apkInfo.components),
      meta_data_count: countMetaData(report.apkInfo.metaData),
      sdk_native_match_count: report.apkInfo.sdkSummary?.native.length || 0,
      sdk_component_match_count: report.apkInfo.sdkSummary?.components.length || 0,
      has_app_icon: Boolean(report.apkInfo.icon?.dataUri),
      app_icon_path: report.apkInfo.icon?.path || null,
      report_path: telegraphPage.path || null,
      source_label: report.sourceLabel,
      ...getArchiveTelemetryFields(report.apkInfo),
    });

    await sendText(
      env,
      message.chat.id,
      formatApkSummary(report),
      message.message_id,
      buildReportReplyMarkup(message.chat, reportUrl, t("bot.open_full_report")),
    );
  } catch (error) {
    logErrorEvent(env, telemetry, "apk.analysis.failed", {
      result: "error",
      duration_ms: Date.now() - startedAt,
      file_name: document.file_name || null,
      file_size_bytes: document.file_size || 0,
      error_name: getErrorName(error),
      error_message: getErrorMessage(error),
      error_stack: getErrorStack(error),
    });
    await sendText(
      env,
      message.chat.id,
      t("bot.parse_failed", {
        message: escapeHtml(getLocalizedErrorMessage(error, locale)),
      }),
      message.message_id,
    );
  }
}

async function analyzeApkUrl(env, message, apkUrl, requestOrigin, telemetry, locale) {
  const startedAt = Date.now();
  const { t } = createI18n(locale);
  const publicBaseUrl = resolvePublicBaseUrl(env, requestOrigin);
  const apkUrlPreviewModuleTask = loadApkUrlPreviewModule();
  void apkUrlPreviewModuleTask.catch(() => {});

  if (supportsChatAction(message.chat?.type)) {
    await sendChatAction(env, message.chat.id, "typing");
  }

  logInfoEvent(
    env,
    telemetry,
    "apk.link_analysis.started",
    {
      result: "started",
      url_host: safeUrlHost(apkUrl),
      url_path: safeUrlPath(apkUrl),
    },
  );

  try {
    const sdkRuleAnnotatorTask = loadSdkRuleAnnotator();
    const telegraphModuleTask = loadTelegraphModule();
    const { readApkInfoFromUrl } = await apkUrlPreviewModuleTask;
    const preview = await readApkInfoFromUrl(apkUrl, getLinkPreviewOptions(env));
    const document = buildUrlPreviewDocument(preview);
    const report = await buildApkReport(
      buildUrlPreviewMessage(message),
      document,
      preview.apkInfo,
      publicBaseUrl,
      locale,
      sdkRuleAnnotatorTask,
    );
    const { createApkTelegraphPage } = await telegraphModuleTask;
    const telegraphPage = await createApkTelegraphPage(env, report);
    const reportUrl = buildReportViewerUrl(publicBaseUrl, telegraphPage.path, locale);

    logInfoEvent(env, telemetry, "apk.link_analysis.succeeded", {
      result: "success",
      duration_ms: Date.now() - startedAt,
      url_host: safeUrlHost(preview.url),
      url_path: safeUrlPath(preview.url),
      file_name: document.file_name || null,
      file_size_bytes: document.file_size || 0,
      content_length_bytes: preview.fileSize || 0,
      downloaded_bytes: preview.stats.downloadedBytes || 0,
      range_request_count: preview.stats.rangeRequestCount || 0,
      link_preview_mode: preview.stats.mode || null,
      package_name: report.apkInfo.packageName,
      version_name: report.apkInfo.versionName,
      permissions_count: report.apkInfo.permissions.length,
      native_library_count: report.apkInfo.nativeLibraries.length,
      component_count: countComponents(report.apkInfo.components),
      meta_data_count: countMetaData(report.apkInfo.metaData),
      sdk_native_match_count: report.apkInfo.sdkSummary?.native.length || 0,
      sdk_component_match_count: report.apkInfo.sdkSummary?.components.length || 0,
      has_app_icon: Boolean(report.apkInfo.icon?.dataUri),
      app_icon_path: report.apkInfo.icon?.path || null,
      report_path: telegraphPage.path || null,
      source_label: report.sourceLabel,
      ...getArchiveTelemetryFields(report.apkInfo),
    });

    await sendText(
      env,
      message.chat.id,
      formatApkSummary(report),
      message.message_id,
      buildReportReplyMarkup(message.chat, reportUrl, t("bot.open_full_report")),
    );
  } catch (error) {
    logErrorEvent(env, telemetry, "apk.link_analysis.failed", {
      result: "error",
      duration_ms: Date.now() - startedAt,
      url_host: safeUrlHost(apkUrl),
      url_path: safeUrlPath(apkUrl),
      error_name: getErrorName(error),
      error_message: getErrorMessage(error),
      error_stack: getErrorStack(error),
    });
    await sendText(
      env,
      message.chat.id,
      t("bot.parse_failed", {
        message: escapeHtml(getLocalizedErrorMessage(error, locale)),
      }),
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
    pathname === "/admin/webhook/delete" ||
    pathname === "/admin/commands" ||
    pathname === "/admin/commands/set" ||
    pathname === "/admin/commands/delete"
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

function resolvePublicBaseUrl(env, requestOrigin) {
  const configured = normalizeBaseUrl(env.PUBLIC_WEBHOOK_URL);
  if (configured) {
    return configured;
  }

  return normalizeBaseUrl(requestOrigin);
}

function normalizeBaseUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/u, "");
}

function normalizeWebhookUrl(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith("/webhook") ? trimmed : `${trimmed.replace(/\/+$/u, "")}/webhook`;
}

function safeUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function safeUrlPath(value) {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function getManagedCommandScopes() {
  return [
    {
      type: "default",
    },
    {
      type: "all_private_chats",
    },
    {
      type: "all_group_chats",
    },
  ];
}

function getManagedCommandTargets() {
  const targets = [];

  for (const scope of getManagedCommandScopes()) {
    for (const languageCode of MANAGED_COMMAND_LANGUAGE_CODES) {
      targets.push({
        scope,
        languageCode,
      });
    }
  }

  return targets;
}

function getCommandScopeKey(scope, languageCode = null) {
  return languageCode ? `${scope?.type || "default"}:${languageCode}` : scope?.type || "default";
}

function getLocalizedBotCommands(locale = undefined) {
  const { t } = createI18n(locale);
  return [
    {
      command: "start",
      description: t("commands.start_description"),
    },
    {
      command: "apkinfo",
      description: t("commands.apkinfo_description"),
    },
    {
      command: "upload",
      description: t("commands.upload_description"),
    },
  ];
}

function normalizeBotCommands(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const commands = value
    .map((item) => ({
      command: String(item?.command || "").trim().toLowerCase(),
      description: String(item?.description || "").trim(),
    }))
    .filter((item) => item.command && item.description);

  return commands.length > 0 ? commands : null;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_CONTENT_HEADERS,
  });
}

function getMessageContentText(message) {
  return [message?.text, message?.caption].filter(Boolean).join("\n").trim();
}

function extractLinksFromMessage(message) {
  const links = [
    ...extractLinksFromText(message?.text, message?.entities),
    ...extractLinksFromText(message?.caption, message?.caption_entities),
  ];
  return [...new Set(links)];
}

function extractLinksFromText(text, entities = []) {
  if (!text) {
    return [];
  }

  const links = [];
  for (const entity of entities || []) {
    if (entity?.type === "text_link" && entity.url) {
      const normalized = normalizeCandidateUrl(entity.url);
      if (normalized) {
        links.push(normalized);
      }
      continue;
    }

    if (entity?.type === "url") {
      const normalized = normalizeCandidateUrl(text.slice(entity.offset, entity.offset + entity.length));
      if (normalized) {
        links.push(normalized);
      }
    }
  }

  const matches = text.match(/https?:\/\/[^\s<>"']+/giu) || [];
  for (const match of matches) {
    const normalized = normalizeCandidateUrl(match);
    if (normalized) {
      links.push(normalized);
    }
  }

  return links;
}

function normalizeCandidateUrl(value) {
  const trimmed = String(value || "")
    .trim()
    .replace(/[),.;!?\]}，。；！？、）】》」』]+$/u, "");

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isLikelyApkUrl(value) {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname).toLowerCase();
    return path.endsWith(".apk") || path.includes(".apk/");
  } catch {
    return false;
  }
}

function extractPrimaryCommand(text) {
  for (const token of extractCommandTokens(text)) {
    if (token === "start" || token === "apkinfo" || token === "upload") {
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

function isBotMentioned(message, botIdentity) {
  if (!botIdentity?.username) {
    return false;
  }

  const expectedMention = `@${botIdentity.username.toLowerCase()}`;
  return (
    messageContainsBotMention(message.text, message.entities, expectedMention) ||
    messageContainsBotMention(message.caption, message.caption_entities, expectedMention)
  );
}

function messageContainsBotMention(text, entities, expectedMention) {
  if (!text || !expectedMention) {
    return false;
  }

  for (const entity of entities || []) {
    if (entity?.type !== "mention") {
      continue;
    }

    const mentionText = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
    if (mentionText === expectedMention) {
      return true;
    }
  }

  return text.toLowerCase().includes(expectedMention);
}

function isApkDocument(document) {
  const fileName = document.file_name?.toLowerCase() || "";
  const mimeType = document.mime_type?.toLowerCase() || "";
  return hasAndroidPackageExtension(fileName) || mimeType.includes("android.package-archive");
}

function isPrivateChat(chat) {
  return chat?.type === "private";
}

function isGroupOrChannelChat(chat) {
  return chat?.type === "group" || chat?.type === "supergroup" || chat?.type === "channel";
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

function normalizeUploadLocale(value) {
  return normalizeLocale(value);
}

function getMaxDirectUploadBytes(env) {
  const configuredMb = Number(env.MAX_DIRECT_UPLOAD_MB || env.MAX_UPLOAD_MB || 0);
  if (Number.isFinite(configuredMb) && configuredMb > 0) {
    return Math.floor(configuredMb * 1024 * 1024);
  }

  return DEFAULT_DIRECT_UPLOAD_BYTES;
}

function getLinkPreviewOptions(env) {
  return {
    maxCentralDirectoryBytes: parseOptionalMegabytes(env.MAX_LINK_PREVIEW_CD_MB),
    maxEntryCompressedBytes: parseOptionalMegabytes(env.MAX_LINK_PREVIEW_ENTRY_MB),
    maxResourceBytes: parseOptionalMegabytes(env.MAX_LINK_PREVIEW_RESOURCE_MB),
  };
}

function parseOptionalMegabytes(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed * 1024 * 1024);
}

function isUploadFile(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.arrayBuffer === "function" &&
      typeof value.name === "string",
  );
}

function isUploadedApkFile(file) {
  const fileName = file.name?.toLowerCase() || "";
  const mimeType = file.type?.toLowerCase() || "";
  return hasAndroidPackageExtension(fileName) || mimeType.includes("android.package-archive");
}

function hasAndroidPackageExtension(fileName) {
  return ANDROID_PACKAGE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

function buildWebUploadMessage(locale) {
  return {
    chat: {
      type: "web_upload",
    },
    from: {
      language_code: locale,
    },
  };
}

function buildUrlPreviewMessage(message) {
  return {
    ...message,
    chat: {
      ...message.chat,
      type: "url_preview",
    },
  };
}

function buildUploadDocument(file) {
  return {
    file_name: file.name || "upload.apk",
    file_size: file.size || 0,
    mime_type: file.type || "application/vnd.android.package-archive",
  };
}

function buildUrlPreviewDocument(preview) {
  return {
    file_name: preview.fileName || "remote.apk",
    file_size: preview.fileSize || 0,
    mime_type: preview.metadata?.contentType || "application/vnd.android.package-archive",
  };
}

function loadApkUrlPreviewModule() {
  if (!apkUrlPreviewModulePromise) {
    apkUrlPreviewModulePromise = import("./apk-url-preview.js")
      .catch((error) => {
        apkUrlPreviewModulePromise = null;
        throw error;
      });
  }

  return apkUrlPreviewModulePromise;
}

function loadReportViewerModule() {
  if (!reportViewerModulePromise) {
    reportViewerModulePromise = import("./report-viewer.js")
      .catch((error) => {
        reportViewerModulePromise = null;
        throw error;
      });
  }

  return reportViewerModulePromise;
}

function loadSdkRuleAnnotator() {
  if (!sdkRuleAnnotatorPromise) {
    sdkRuleAnnotatorPromise = Promise.all([
      import("../../shared/src/generated/libchecker-rules-core.js"),
      import("../../shared/src/generated/libchecker-rules-detail.js"),
    ])
      .then(([rulesModule, detailsModule]) => createSdkMarkerAnnotator(
        rulesModule.LIBCHECKER_RULES_CORE || [],
        detailsModule.LIBCHECKER_RULE_DETAILS || {},
      ))
      .catch((error) => {
        sdkRuleAnnotatorPromise = null;
        throw error;
      });
  }

  return sdkRuleAnnotatorPromise;
}

function loadTelegraphModule() {
  if (!telegraphModulePromise) {
    telegraphModulePromise = import("./telegraph.js")
      .catch((error) => {
        telegraphModulePromise = null;
        throw error;
      });
  }

  return telegraphModulePromise;
}

function loadUploadViewModule() {
  if (!uploadViewModulePromise) {
    uploadViewModulePromise = import("./upload-view.js")
      .catch((error) => {
        uploadViewModulePromise = null;
        throw error;
      });
  }

  return uploadViewModulePromise;
}

async function renderUploadResponse(options, status = 200) {
  const { htmlResponse, renderUploadPage } = await loadUploadViewModule();
  return htmlResponse(renderUploadPage(options), status);
}

async function buildApkReport(
  message,
  document,
  apkInfo,
  publicBaseUrl,
  locale,
  sdkRuleAnnotatorTask = loadSdkRuleAnnotator(),
) {
  const resolveSdkIconUrl = (iconName) => buildSdkIconUrl(publicBaseUrl, iconName);
  const annotateSdkMarkers = await sdkRuleAnnotatorTask;
  const sdkAnnotated = annotateSdkMarkers(apkInfo, resolveSdkIconUrl);

  return assertTelegramApkReport({
    locale,
    apkInfo: {
      ...apkInfo,
      ...sdkAnnotated,
    },
    fileName: document.file_name || "unknown.apk",
    fileSizeText: formatBytes(document.file_size || 0),
    sourceLabel: describeMessageSource(message, locale),
    analyzedAt: new Date().toISOString(),
    featureIcons: {
      kotlin: buildFeatureIconUrl(publicBaseUrl, "kotlin"),
      gradle: buildFeatureIconUrl(publicBaseUrl, "gradle"),
      compose: buildFeatureIconUrl(publicBaseUrl, "compose"),
    },
  });
}

function buildReportViewerUrl(publicBaseUrl, path, locale) {
  const searchParams = new URLSearchParams({
    path: path || "",
    lang: locale,
  });
  return `${publicBaseUrl}/report?${searchParams.toString()}`;
}

function buildReportReplyMarkup(chat, reportUrl, buttonText) {
  return buildLinkReplyMarkup(chat, reportUrl, buttonText);
}

function buildLinkReplyMarkup(chat, url, buttonText) {
  const button = isPrivateChat(chat)
    ? {
        text: buttonText,
        web_app: {
          url,
        },
      }
    : {
        text: buttonText,
        url,
      };

  return {
    inline_keyboard: [
      [button],
    ],
  };
}

function buildUploadUrl(publicBaseUrl, locale) {
  const searchParams = new URLSearchParams({
    lang: locale,
  });
  return `${publicBaseUrl}/upload?${searchParams.toString()}`;
}

function describeMessageSource(message, locale) {
  const { t } = createI18n(locale);
  if (message.chat?.type === "web_upload") {
    return t("bot.source_web_upload");
  }

  if (message.chat?.type === "url_preview") {
    return t("bot.source_link_preview");
  }

  if (message.chat?.type === "channel") {
    return t("bot.source_channel");
  }

  if (isForwardedMessage(message)) {
    return t("bot.source_forwarded");
  }

  if (isPrivateChat(message.chat)) {
    return t("bot.source_private");
  }

  if (message.chat?.type === "supergroup" || message.chat?.type === "group") {
    return t("bot.source_group");
  }

  return t("bot.source_default");
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

async function downloadTelegramFile(env, fileId, locale = undefined) {
  const startedAt = Date.now();
  const file = await telegramApi(env, "getFile", { file_id: fileId }, locale);
  if (!file?.file_path) {
    const { t } = createI18n(locale);
    throw new Error(t("errors.telegram_missing_file_path"));
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${env.BOT_TOKEN}/${file.file_path}`);
  if (!response.ok) {
    logErrorEvent(env, { surface: "worker", route: "telegram_file" }, "telegram.file_download.failed", {
      http_status: response.status,
      result: "error",
      duration_ms: Date.now() - startedAt,
    });
    const { t } = createI18n(locale);
    throw new Error(t("errors.telegram_file_download_failed", { status: response.status }));
  }

  const buffer = await response.arrayBuffer();
  logInfoEvent(env, { surface: "worker", route: "telegram_file" }, "telegram.file_download.succeeded", {
    result: "success",
    duration_ms: Date.now() - startedAt,
    downloaded_bytes: buffer.byteLength || 0,
    http_status: response.status,
  });
  return buffer;
}

async function sendText(env, chatId, text, replyToMessageId, replyMarkup = undefined) {
  await telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_to_message_id: replyToMessageId,
    reply_markup: replyMarkup,
  });
}

async function sendChatAction(env, chatId, action) {
  await telegramApi(env, "sendChatAction", {
    chat_id: chatId,
    action,
  });
}

async function telegramApi(env, method, payload, locale = undefined) {
  const startedAt = Date.now();
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: JSON_CONTENT_HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    logErrorEvent(env, { surface: "worker", route: "telegram_api" }, "telegram.api.failed", {
      command: method,
      telegram_method: method,
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
      result: "error",
    });
    const { t } = createI18n(locale);
    throw new Error(t("errors.telegram_api_request_failed", { method, status: response.status }));
  }

  const data = await response.json();
  if (!data.ok) {
    logWarnEvent(env, { surface: "worker", route: "telegram_api" }, "telegram.api.failed", {
      command: method,
      telegram_method: method,
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
      error_code: data.error_code || null,
      error_name: "TelegramApiResultError",
      result: "error",
    });
    const { t } = createI18n(locale);
    throw new Error(data.description || t("errors.telegram_api_result_failed", { method }));
  }

  logInfoEvent(env, { surface: "worker", route: "telegram_api" }, "telegram.api.succeeded", {
    command: method,
    telegram_method: method,
    http_status: response.status,
    duration_ms: Date.now() - startedAt,
    result: "success",
  });

  return data.result;
}

async function getBotIdentity(env) {
  if (cachedBotIdentity) {
    return cachedBotIdentity;
  }

  const identity = await telegramApi(env, "getMe", {});
  cachedBotIdentity = {
    id: identity.id,
    username: identity.username || null,
  };
  return cachedBotIdentity;
}

function formatApkSummary(report) {
  const { t } = createI18n(report.locale);
  const lines = [
    t("summary.completed"),
    t("summary.app_name", {
      appName: escapeHtml(report.apkInfo.appName),
    }),
    t("summary.package_name", {
      packageName: escapeHtml(report.apkInfo.packageName),
    }),
    t("summary.version_name", {
      versionName: escapeHtml(report.apkInfo.versionName),
    }),
    t("summary.version_code", {
      versionCode: escapeHtml(report.apkInfo.versionCode),
    }),
    t("summary.sdk", {
      targetSdk: escapeHtml(report.apkInfo.targetSdk),
      minSdk: escapeHtml(report.apkInfo.minSdk),
      compileSdk: escapeHtml(report.apkInfo.compileSdk),
    }),
    t("summary.permissions_count", {
      count: report.apkInfo.permissions.length,
    }),
    t("summary.native_library_count", {
      count: report.apkInfo.nativeLibraries.length,
    }),
    t("summary.component_count", {
      count: countComponents(report.apkInfo.components),
    }),
    t("summary.meta_data_count", {
      count: countMetaData(report.apkInfo.metaData),
    }),
  ];

  const sdkMarkerSummary = formatSdkMarkerSummary(report.apkInfo.sdkSummary, t);
  if (sdkMarkerSummary) {
    lines.push(t("summary.sdk_markers", { value: sdkMarkerSummary }));
  }

  const featureHtml = formatFeatureChipsHtml(report.apkInfo.buildFeatures);
  if (featureHtml) {
    lines.push(t("summary.features", { value: featureHtml }));
  }

  lines.push("", t("summary.open_report_hint"));
  return lines.join("\n");
}

function formatSdkMarkerSummary(sdkSummary, t) {
  if (!sdkSummary) {
    return "";
  }

  const parts = [];
  if (sdkSummary.native.length > 0) {
    parts.push(t("summary.sdk_summary_native", { count: sdkSummary.native.length }));
  }
  if (sdkSummary.components.length > 0) {
    parts.push(t("summary.sdk_summary_components", { count: sdkSummary.components.length }));
  }

  return parts.join(" · ");
}

function formatFeatureChipsHtml(buildFeatures) {
  const chips = [];

  if (buildFeatures.kotlinDetected) {
    chips.push(buildHtmlChip(`🟣 ${buildFeatureLabel("Kotlin", buildFeatures.kotlinVersion)}`));
  }

  if (buildFeatures.composeDetected) {
    chips.push(buildHtmlChip(`🎨 ${buildFeatureLabel("Compose", buildFeatures.composeVersion)}`));
  }

  if (buildFeatures.gradleVersion) {
    chips.push(buildHtmlChip(`🟢 Gradle ${buildFeatures.gradleVersion}`));
  }

  if (buildFeatures.agpVersion) {
    chips.push(buildHtmlChip(`🧱 AGP ${buildFeatures.agpVersion}`));
  }

  return chips.join(" ");
}

function buildHtmlChip(text) {
  return `<code>${escapeHtml(text)}</code>`;
}

function buildFeatureLabel(name, version) {
  return version ? `${name} ${version}` : name;
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
  return metaData.application.length;
}

function getArchiveTelemetryFields(apkInfo = {}) {
  const archive = apkInfo.archive || null;
  if (!archive) {
    return {
      archive_type: "apk",
      apk_entry_count: 1,
    };
  }

  return {
    archive_type: archive.type || "package-container",
    apk_entry_count:
      archive.apkEntryCount ||
      archive.apkEntries?.length ||
      archive.apkEntryDetails?.length ||
      1,
  };
}

function buildMessageTelemetryFields(update, message, command, botMentioned, locale) {
  const links = extractLinksFromMessage(message);
  return {
    update_type: getUpdateType(update),
    locale,
    chat_type: message.chat?.type || null,
    chat_id: message.chat?.id != null ? String(message.chat.id) : null,
    message_id: message.message_id || null,
    message_thread_id: message.message_thread_id || null,
    from_id: message.from?.id != null ? String(message.from.id) : null,
    command: command || null,
    bot_mentioned: botMentioned,
    is_forwarded: isForwardedMessage(message),
    is_automatic_forward: Boolean(message.is_automatic_forward),
    has_document: Boolean(message.document),
    has_apk_document: Boolean(getApkDocument(message)),
    has_url: links.length > 0,
    has_apk_url: links.some(isLikelyApkUrl),
    source_label: describeMessageSource(message),
  };
}

function getUpdateType(update) {
  if (update?.message) {
    return "message";
  }

  if (update?.edited_message) {
    return "edited_message";
  }

  if (update?.channel_post) {
    return "channel_post";
  }

  if (update?.edited_channel_post) {
    return "edited_channel_post";
  }

  return "unknown";
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

  return "Unknown error";
}

function getLocalizedErrorMessage(error, locale) {
  if (error instanceof Error) {
    return error.message;
  }

  return createI18n(locale).t("errors.unknown");
}

function getErrorName(error) {
  if (error instanceof Error) {
    return error.name || "Error";
  }

  return "UnknownError";
}

function getErrorStack(error) {
  if (error instanceof Error && error.stack) {
    return error.stack;
  }

  return null;
}
