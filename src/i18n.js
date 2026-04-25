export const DEFAULT_LOCALE = "zh-CN";

const DICTIONARIES = {
  "zh-CN": {
    commands: {
      start_description: "显示使用说明",
      apkinfo_description: "解析当前或回复的 APK 文件",
      upload_description: "上传大 APK 文件解析",
    },
    bot: {
      start:
        "你好，直接发送或转发 APK 文件我就会自动解析；也可以直接发送 APK 下载链接，我会尝试用 HTTP Range 只下载少量元数据来解析。群组和频道里也支持直接发 APK、把 <code>/apkinfo</code> 写在 APK 消息里或 APK 链接旁边，或者回复含 APK 的消息发送 <code>/apkinfo</code>。超过 20MB 的 APK 可以使用 <code>/upload</code> 打开网页上传入口。",
      apk_not_found:
        "我没有找到可解析的 APK。你可以直接发送或转发 APK 文件、发送 APK 下载链接，或者把 <code>/apkinfo</code> 写在同一条 APK 消息或链接消息里；如果是回复解析，也请确认你回复的那条消息本身就是 APK 文件或 APK 链接。需要注意的是，群组里的转发 APK 有时不会把文件对象完整发给 bot，这种情况下我无法从 Telegram 重新取回它，建议直接在群里发送 APK、发送 APK 下载链接，或私聊 bot 再转发 APK。若群组开启了 Privacy Mode，请优先使用 <code>/apkinfo@bot_username</code>。",
      apk_too_large:
        "这个 APK 超过 Telegram 官方 Bot API 当前可下载的 20MB 限制。请使用下方按钮打开网页上传入口，直接把 APK 上传到 Worker 解析。",
      upload_entry:
        "打开网页上传入口后选择 APK 文件即可解析。这个入口绕过 Telegram Bot API 的 20MB 文件下载限制，但仍会受到 Cloudflare Worker 请求体和内存限制影响。",
      parse_failed: "解析 APK 失败：<code>{message}</code>",
      open_full_report: "打开完整报告",
      open_upload_page: "上传大 APK",
      source_channel: "频道消息",
      source_forwarded: "转发消息",
      source_private: "私聊消息",
      source_group: "群组消息",
      source_web_upload: "网页上传",
      source_link_preview: "链接预览",
      source_default: "Telegram 消息",
    },
    upload: {
      page_title: "上传 APK 解析",
      heading: "上传 APK 解析",
      intro: "直接把 APK 上传到 Worker 解析，适合超过 Telegram Bot API 20MB 下载限制的文件。",
      file_label: "APK 文件",
      language_label: "报告语言",
      submit: "开始解析",
      busy: "正在上传并解析...",
      progress_label: "上传进度",
      progress_preparing: "准备上传...",
      progress_complete: "上传完成，正在生成报告...",
      network_error: "上传失败，请检查网络后重试。",
      max_hint: "当前入口建议上传不超过 {maxSize} 的 APK。",
      choose_file: "选择一个 .apk 文件。",
      invalid_file: "请上传 .apk 文件。",
      too_large: "文件超过当前 Worker 上传解析上限：{maxSize}。",
      parse_failed: "解析 APK 失败：{message}",
    },
    summary: {
      completed: "<b>APK 解析完成</b>",
      app_name: "应用名: <b>{appName}</b>",
      package_name: "包名: <code>{packageName}</code>",
      version_name: "versionName: <code>{versionName}</code>",
      version_code: "versionCode: <code>{versionCode}</code>",
      sdk: "SDK: <code>Target {targetSdk} / Min {minSdk} / Compile {compileSdk}</code>",
      permissions_count: "权限数量: <b>{count}</b>",
      native_library_count: "原生库数量: <b>{count}</b>",
      component_count: "组件数量: <b>{count}</b>",
      meta_data_count: "meta-data 数量: <b>{count}</b>",
      sdk_markers: "SDK 标记: {value}",
      features: "特性: {value}",
      open_report_hint: "完整报告请使用下方按钮打开。",
      sdk_summary_native: "原生库 <b>{count}</b>",
      sdk_summary_components: "组件 <b>{count}</b>",
    },
    report: {
      fallback_title: "APK 报告",
      error_title: "报告加载失败",
      missing_path: "缺少 report path 参数。",
      views: "浏览 {count}",
      meta_fallback: "APK 解析报告",
    },
    telegraph: {
      page_title: "{appName} APK 信息",
      apk_summary: "APK 摘要",
      file_info: "文件信息",
      native_libraries: "原生库",
      build_features: "构建特性",
      permissions: "权限",
      components: "组件",
      application_meta_data: "Application Meta-Data",
      native_sdk_markers: "原生库 SDK 标记",
      marked_sdks: "已标记的 SDK",
      line_app: "应用: {value}",
      line_package_name: "包名: {value}",
      line_version: "版本: {versionName} ({versionCode})",
      line_sdk: "SDK: Target {targetSdk} / Min {minSdk} / Compile {compileSdk}",
      line_stats:
        "统计: 权限 {permissions} · 原生库 {nativeLibraries} · 组件 {components} · meta-data {metaData}",
      line_file_name: "文件名: {value}",
      line_file_size: "文件大小: {value}",
      line_message_source: "消息来源: {value}",
      line_analyzed_at: "分析时间: {value}",
      report_compacted_notice:
        "报告内容超过 Telegraph 单页限制，已自动切换为精简版：统计仍基于完整 APK，列表仅展示前若干项。",
      no_build_features: "未识别到构建特性。",
      no_native_libraries: "未发现原生库。",
      no_permissions: "未声明权限。",
      no_component: "未声明 {title}。",
      no_application_meta_data: "未声明 application 级 meta-data。",
      alias_target: "alias -> {target}",
      resource_resolved: "resolved from string resource",
      resource_reference: "resource reference",
      feature_detected: "已检测到",
      feature_kotlin: "Kotlin",
      feature_compose: "Compose",
      feature_gradle: "Gradle",
      feature_agp: "Android Gradle Plugin",
      feature_app_metadata_version: "App Metadata Version",
      unknown: "未知",
    },
    errors: {
      unknown: "未知错误",
      telegram_missing_file_path: "Telegram 没有返回可下载的 file_path",
      telegram_file_download_failed: "Telegram 文件下载失败 ({status})",
      telegram_api_request_failed: "Telegram API {method} 请求失败 ({status})",
      telegram_api_result_failed: "Telegram API {method} 返回失败",
      telegraph_invalid_path: "Telegraph 页面路径无效",
      telegraph_fetch_failed: "Telegraph 页面获取失败 ({status})",
      telegraph_fetch_failed_generic: "Telegraph 页面获取失败",
      telegraph_api_failed: "Telegraph API {method} 请求失败 ({status})",
      telegraph_api_result_failed: "Telegraph API {method} 返回失败",
    },
  },
  en: {
    commands: {
      start_description: "Show usage instructions",
      apkinfo_description: "Analyze the current or replied APK file",
      upload_description: "Upload a large APK for analysis",
    },
    bot: {
      start:
        "Hi! Send or forward an APK file and I'll analyze it automatically. You can also send an APK download link, and I'll try to parse it with HTTP Range by downloading only a small amount of metadata. In groups and channels, you can send an APK directly, put <code>/apkinfo</code> in the APK message or next to the APK link, or reply to a message containing an APK with <code>/apkinfo</code>. For APKs larger than 20 MB, use <code>/upload</code> to open the web upload entry.",
      apk_not_found:
        "I couldn't find a parsable APK. You can send or forward an APK file directly, send an APK download link, or put <code>/apkinfo</code> in the same APK/link message. If you're replying to analyze, make sure the replied message itself is an APK file or APK link. In groups, forwarded APKs may not always include a complete file object for the bot, so I may be unable to retrieve them again from Telegram. In that case, please send the APK directly in the group, send an APK download link, or forward it to me in a private chat. If Privacy Mode is enabled in the group, prefer using <code>/apkinfo@bot_username</code>.",
      apk_too_large:
        "This APK exceeds Telegram Bot API's current 20 MB download limit. Use the button below to open the web upload entry and upload the APK directly to the Worker for analysis.",
      upload_entry:
        "Open the web upload entry, choose an APK file, and it will be parsed directly by the Worker. This bypasses Telegram Bot API's 20 MB file download limit, but Cloudflare Worker request body and memory limits still apply.",
      parse_failed: "Failed to parse APK: <code>{message}</code>",
      open_full_report: "Open Full Report",
      open_upload_page: "Upload Large APK",
      source_channel: "Channel Message",
      source_forwarded: "Forwarded Message",
      source_private: "Private Chat Message",
      source_group: "Group Message",
      source_web_upload: "Web Upload",
      source_link_preview: "Link Preview",
      source_default: "Telegram Message",
    },
    upload: {
      page_title: "Upload APK for Analysis",
      heading: "Upload APK for Analysis",
      intro: "Upload an APK directly to the Worker. This is intended for files larger than Telegram Bot API's 20 MB download limit.",
      file_label: "APK File",
      language_label: "Report Language",
      submit: "Analyze",
      busy: "Uploading and analyzing...",
      progress_label: "Upload Progress",
      progress_preparing: "Preparing upload...",
      progress_complete: "Upload complete. Generating report...",
      network_error: "Upload failed. Please check your connection and try again.",
      max_hint: "This entry currently recommends APKs up to {maxSize}.",
      choose_file: "Choose an .apk file.",
      invalid_file: "Please upload an .apk file.",
      too_large: "The file exceeds the current Worker upload analysis limit: {maxSize}.",
      parse_failed: "Failed to parse APK: {message}",
    },
    summary: {
      completed: "<b>APK Analysis Complete</b>",
      app_name: "App Name: <b>{appName}</b>",
      package_name: "Package Name: <code>{packageName}</code>",
      version_name: "Version Name: <code>{versionName}</code>",
      version_code: "Version Code: <code>{versionCode}</code>",
      sdk: "SDK: <code>Target {targetSdk} / Min {minSdk} / Compile {compileSdk}</code>",
      permissions_count: "Permissions: <b>{count}</b>",
      native_library_count: "Native Libraries: <b>{count}</b>",
      component_count: "Components: <b>{count}</b>",
      meta_data_count: "Meta-Data: <b>{count}</b>",
      sdk_markers: "SDK Markers: {value}",
      features: "Features: {value}",
      open_report_hint: "Use the button below to open the full report.",
      sdk_summary_native: "Native Libraries <b>{count}</b>",
      sdk_summary_components: "Components <b>{count}</b>",
    },
    report: {
      fallback_title: "APK Report",
      error_title: "Failed to Load Report",
      missing_path: "Missing report path parameter.",
      views: "Views {count}",
      meta_fallback: "APK Analysis Report",
    },
    telegraph: {
      page_title: "{appName} APK Info",
      apk_summary: "APK Summary",
      file_info: "File Info",
      native_libraries: "Native Libraries",
      build_features: "Build Features",
      permissions: "Permissions",
      components: "Components",
      application_meta_data: "Application Meta-Data",
      native_sdk_markers: "Native Library SDK Markers",
      marked_sdks: "Marked SDKs",
      line_app: "App: {value}",
      line_package_name: "Package Name: {value}",
      line_version: "Version: {versionName} ({versionCode})",
      line_sdk: "SDK: Target {targetSdk} / Min {minSdk} / Compile {compileSdk}",
      line_stats:
        "Stats: Permissions {permissions} · Native Libraries {nativeLibraries} · Components {components} · Meta-Data {metaData}",
      line_file_name: "File Name: {value}",
      line_file_size: "File Size: {value}",
      line_message_source: "Message Source: {value}",
      line_analyzed_at: "Analyzed At: {value}",
      report_compacted_notice:
        "The report exceeded Telegraph's single-page content limit, so a compact version was generated automatically. Stats still use the full APK, while lists only show the first items.",
      no_build_features: "No build features detected.",
      no_native_libraries: "No native libraries found.",
      no_permissions: "No permissions declared.",
      no_component: "No {title} declared.",
      no_application_meta_data: "No application-level meta-data declared.",
      alias_target: "alias -> {target}",
      resource_resolved: "resolved from string resource",
      resource_reference: "resource reference",
      feature_detected: "Detected",
      feature_kotlin: "Kotlin",
      feature_compose: "Compose",
      feature_gradle: "Gradle",
      feature_agp: "Android Gradle Plugin",
      feature_app_metadata_version: "App Metadata Version",
      unknown: "Unknown",
    },
    errors: {
      unknown: "Unknown error",
      telegram_missing_file_path: "Telegram did not return a downloadable file_path",
      telegram_file_download_failed: "Telegram file download failed ({status})",
      telegram_api_request_failed: "Telegram API {method} request failed ({status})",
      telegram_api_result_failed: "Telegram API {method} returned an error",
      telegraph_invalid_path: "Invalid Telegraph page path",
      telegraph_fetch_failed: "Failed to fetch Telegraph page ({status})",
      telegraph_fetch_failed_generic: "Failed to fetch Telegraph page",
      telegraph_api_failed: "Telegraph API {method} request failed ({status})",
      telegraph_api_result_failed: "Telegraph API {method} returned an error",
    },
  },
};

export function createI18n(localeInput) {
  const locale = normalizeLocale(localeInput);
  const dictionary = DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];

  return {
    locale,
    languageTag: locale === "en" ? "en" : "zh-CN",
    t(key, variables = {}) {
      const template = resolveMessage(dictionary, key) ?? resolveMessage(DICTIONARIES[DEFAULT_LOCALE], key) ?? key;
      return formatMessage(template, variables);
    },
  };
}

export function normalizeLocale(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_LOCALE;
  }

  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }

  if (normalized.startsWith("en")) {
    return "en";
  }

  return DEFAULT_LOCALE;
}

export function resolveTelegramLocale(message) {
  const candidates = [
    message?.from?.language_code,
    message?.reply_to_message?.from?.language_code,
    message?.external_reply?.origin?.sender_user?.language_code,
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return normalizeLocale(candidate);
    }
  }

  return DEFAULT_LOCALE;
}

function resolveMessage(dictionary, key) {
  return key.split(".").reduce((current, part) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return current[part];
  }, dictionary);
}

function formatMessage(template, variables) {
  return String(template).replace(/\{(\w+)\}/gu, (_, key) => {
    const value = variables[key];
    return value == null ? "" : String(value);
  });
}
