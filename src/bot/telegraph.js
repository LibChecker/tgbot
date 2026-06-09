import { createI18n } from "./i18n.js";
import { logErrorEvent, logInfoEvent, logWarnEvent } from "./observability.js";

const TELEGRAPH_API_BASE = "https://api.telegra.ph";
const COMPACT_LEVELS = [
  {
    nativeLibraries: 160,
    permissions: 120,
    componentsPerType: 160,
    metaData: 80,
    sdkSummary: 48,
    sdkPreviewItems: 6,
  },
  {
    nativeLibraries: 60,
    permissions: 60,
    componentsPerType: 60,
    metaData: 30,
    sdkSummary: 24,
    sdkPreviewItems: 4,
  },
  {
    nativeLibraries: 20,
    permissions: 30,
    componentsPerType: 20,
    metaData: 12,
    sdkSummary: 12,
    sdkPreviewItems: 3,
  },
];

let cachedAccessToken = null;

export async function createApkTelegraphPage(env, report) {
  const accessToken = await getTelegraphAccessToken(env);
  const { t } = createI18n(report.locale);

  try {
    return await createTelegraphPageResilient(env, accessToken, report, t);
  } catch (error) {
    if (!isContentTooBigError(error)) {
      throw error;
    }
  }

  for (const limits of COMPACT_LEVELS) {
    try {
      return await createTelegraphPageResilient(env, accessToken, compactReport(report, limits), t);
    } catch (error) {
      if (!isContentTooBigError(error)) {
        throw error;
      }
    }
  }

  try {
    return await createTelegraphPageResilient(env, accessToken, buildMinimalReport(report), t);
  } catch (error) {
    if (report.apkInfo.icon?.dataUri && isContentTooBigError(error)) {
      return createTelegraphPageResilient(env, accessToken, stripReportIcon(buildMinimalReport(report)), t);
    }
    throw error;
  }
}

export async function fetchTelegraphPage(path, locale = undefined, env = {}) {
  const startedAt = Date.now();
  const { t } = createI18n(locale);
  const normalizedPath = normalizeTelegraphPath(path);
  if (!normalizedPath) {
    throw new Error(t("errors.telegraph_invalid_path"));
  }

  const response = await fetch(
    `${TELEGRAPH_API_BASE}/getPage/${encodeURIComponent(normalizedPath)}?return_content=true`,
    {
      headers: {
        accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    logErrorEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: "getPage",
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
      },
    );
    throw new Error(t("errors.telegraph_fetch_failed", { status: response.status }));
  }

  const data = await response.json();
  if (!data.ok) {
    logWarnEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: "getPage",
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
        error_name: "TelegraphApiResultError",
      },
    );
    throw new Error(data.error || t("errors.telegraph_fetch_failed_generic"));
  }

  logInfoEvent(
    env,
    { surface: "worker", route: "telegraph_api" },
    "telegraph.api.succeeded",
    {
      command: "getPage",
      result: "success",
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
    },
  );

  return data.result;
}

async function getTelegraphAccessToken(env) {
  const configured = normalizeText(env.TELEGRAPH_ACCESS_TOKEN);
  if (configured) {
    return configured;
  }

  if (cachedAccessToken) {
    return cachedAccessToken;
  }

  const account = await telegraphApi(env, "createAccount", {
    short_name: normalizeShortName(env.TELEGRAPH_SHORT_NAME) || "tgbot",
    author_name: getAuthorName(env),
    author_url: normalizeText(env.TELEGRAPH_AUTHOR_URL) || undefined,
  });

  cachedAccessToken = account.access_token;
  return cachedAccessToken;
}

async function telegraphApi(env, method, payload, locale = undefined) {
  const startedAt = Date.now();
  const { t } = createI18n(locale);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) {
    if (value == null) {
      continue;
    }

    body.set(key, String(value));
  }

  const response = await fetch(`${TELEGRAPH_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });

  if (!response.ok) {
    logErrorEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: method,
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
      },
    );
    throw new Error(t("errors.telegraph_api_failed", { method, status: response.status }));
  }

  const data = await response.json();
  if (!data.ok) {
    logWarnEvent(
      env,
      { surface: "worker", route: "telegraph_api" },
      "telegraph.api.failed",
      {
        command: method,
        result: "error",
        http_status: response.status,
        duration_ms: Date.now() - startedAt,
        error_name: "TelegraphApiResultError",
      },
    );
    throw new Error(data.error || t("errors.telegraph_api_result_failed", { method }));
  }

  logInfoEvent(
    env,
    { surface: "worker", route: "telegraph_api" },
    "telegraph.api.succeeded",
    {
      command: method,
      result: "success",
      http_status: response.status,
      duration_ms: Date.now() - startedAt,
    },
  );

  return data.result;
}

async function createTelegraphPage(env, accessToken, report, t) {
  const content = buildTelegraphContent(report, t);
  return telegraphApi(env, "createPage", {
    access_token: accessToken,
    title: buildPageTitle(report, t),
    author_name: getAuthorName(env),
    author_url: normalizeText(env.TELEGRAPH_AUTHOR_URL) || undefined,
    content: JSON.stringify(content),
    return_content: false,
  }, report.locale);
}

async function createTelegraphPageResilient(env, accessToken, report, t) {
  try {
    return await createTelegraphPage(env, accessToken, report, t);
  } catch (error) {
    if (report.apkInfo.icon?.dataUri && isPotentialIconContentError(error)) {
      return createTelegraphPage(env, accessToken, stripReportIcon(report), t);
    }
    throw error;
  }
}

function isContentTooBigError(error) {
  return error instanceof Error && error.message.includes("CONTENT_TOO_BIG");
}

function isPotentialIconContentError(error) {
  return (
    error instanceof Error &&
    /CONTENT_FORMAT_INVALID|IMG|IMAGE|SRC/i.test(error.message)
  );
}

function stripReportIcon(report) {
  return {
    ...report,
    apkInfo: {
      ...report.apkInfo,
      icon: null,
    },
  };
}

function buildPageTitle(report, t) {
  return truncateText(normalizeText(report.apkInfo.appName) || t("report.fallback_title"), 256);
}

function getAuthorName(env) {
  return truncateText(normalizeText(env.TELEGRAPH_AUTHOR_NAME) || "Telegram APK Info Bot", 128);
}

function normalizeShortName(value) {
  const normalized = normalizeText(value) || null;
  if (!normalized) {
    return null;
  }

  return truncateText(normalized.replaceAll(/\s+/gu, "-"), 32);
}

function normalizeTelegraphPath(value) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.includes("/") || normalized.includes("?")) {
    return null;
  }

  return normalized;
}

function buildTelegraphContent(report, t) {
  const featureChips = buildFeatureChips(report);
  const featureDetails = buildFeatureDetails(report.apkInfo.buildFeatures, t);
  const stats = getReportStats(report);
  const sections = [
    ...(report.apkInfo.icon?.dataUri ? [appIconDataMarker(report)] : []),
    h3(t("telegraph.apk_summary")),
    preBlock([
      t("telegraph.line_app", { value: report.apkInfo.appName }),
      t("telegraph.line_package_name", { value: report.apkInfo.packageName }),
      t("telegraph.line_icon", {
        value: formatIconSummary(report, t),
      }),
      t("telegraph.line_version", {
        versionName: report.apkInfo.versionName,
        versionCode: report.apkInfo.versionCode,
      }),
      t("telegraph.line_sdk", {
        targetSdk: report.apkInfo.targetSdk,
        minSdk: report.apkInfo.minSdk,
        compileSdk: report.apkInfo.compileSdk,
      }),
      t("telegraph.line_stats", {
        permissions: stats.permissions,
        nativeLibraries: stats.nativeLibraries,
        components: stats.components,
        metaData: stats.metaData,
      }),
    ]),
    h3(t("telegraph.file_info")),
    preBlock([
      t("telegraph.line_file_name", { value: report.fileName }),
      t("telegraph.line_file_size", { value: report.fileSizeText }),
      t("telegraph.line_message_source", { value: report.sourceLabel }),
      t("telegraph.line_analyzed_at", { value: report.analyzedAt }),
    ]),
    hrNode(),
    h3(t("telegraph.native_libraries")),
  ];

  if (report.isCompacted) {
    sections.push(paragraph(t("telegraph.report_compacted_notice")));
  }

  if (featureChips.length > 0 || featureDetails.length > 0) {
    sections.splice(
      2,
      0,
      ...(featureChips.length > 0 ? [chipParagraph(featureChips)] : []),
      hrNode(),
      h3(t("telegraph.build_features")),
      ...(featureDetails.length > 0
        ? [unorderedList(featureDetails)]
        : [paragraph(t("telegraph.no_build_features"))]),
      hrNode(),
    );
  }

  pushSdkSummarySection(sections, report.apkInfo.sdkSummary?.native, t("telegraph.native_sdk_markers"));
  pushNativeLibraries(sections, report.apkInfo.nativeLibraries, t);

  sections.push(hrNode(), h3(t("telegraph.permissions")));
  pushPermissions(sections, report.apkInfo.permissions, t);

  sections.push(hrNode(), h3(t("telegraph.components")));
  pushSdkSummarySection(sections, report.apkInfo.sdkSummary?.components, t("telegraph.marked_sdks"));
  pushComponentSection(sections, "Activity", report.apkInfo.components.activities, t);
  pushComponentSection(sections, "Service", report.apkInfo.components.services, t);
  pushComponentSection(sections, "Receiver", report.apkInfo.components.receivers, t);
  pushComponentSection(sections, "Provider", report.apkInfo.components.providers, t);

  sections.push(hrNode(), h3(t("telegraph.application_meta_data")));
  pushMetaDataSection(sections, report.apkInfo.metaData.application, t);

  return sections;
}

function pushNativeLibraries(sections, libraries, t) {
  if (libraries.length === 0) {
    sections.push(paragraph(t("telegraph.no_native_libraries")));
    return;
  }

  const librariesByAbi = new Map();
  for (const library of libraries) {
    const abiLibraries = librariesByAbi.get(library.abi) || [];
    abiLibraries.push(library);
    librariesByAbi.set(library.abi, abiLibraries);
  }

  for (const [abi, abiLibraries] of librariesByAbi.entries()) {
    sections.push(h4(`${abi} (${abiLibraries.length})`));
    sections.push(unorderedList(abiLibraries.map((library) => nativeLibraryItem(library))));
  }
}

function appIconDataMarker(report) {
  return {
    tag: "p",
    children: [codeNode(`LC_APP_ICON_DATA:${report.apkInfo.icon.dataUri}`)],
  };
}

function pushPermissions(sections, permissions, t) {
  if (permissions.length === 0) {
    sections.push(paragraph(t("telegraph.no_permissions")));
    return;
  }

  sections.push(unorderedList(permissions.map((permission) => permissionItem(permission))));
}

function pushComponentSection(sections, title, components, t) {
  sections.push(h4(`${title} (${components.length})`));

  if (components.length === 0) {
    sections.push(paragraph(t("telegraph.no_component", { title })));
    return;
  }

  sections.push(unorderedList(components.map((component) => componentItem(component, t))));
}

function pushMetaDataSection(sections, metaDataItems, t) {
  if (metaDataItems.length === 0) {
    sections.push(paragraph(t("telegraph.no_application_meta_data")));
    return;
  }

  sections.push(unorderedList(metaDataItems.map((item) => metaDataItem(item, t))));
}

function pushSdkSummarySection(sections, entries, title) {
  if (!entries || entries.length === 0) {
    return;
  }

  sections.push(h4(title));
  sections.push(unorderedList(entries.map((entry) => sdkSummaryItem(entry))));
}

function nativeLibraryItem(library) {
  const children = [codeNode(library.name)];

  if (library.sdk) {
    children.push(brNode(), ...sdkChipNodes(library.sdk));
  }

  children.push(brNode(), emNode(`${formatBytes(library.size)} · ${library.path}`));

  return {
    tag: "li",
    children,
  };
}

function permissionItem(permission) {
  return {
    tag: "li",
    children: [codeNode(permission)],
  };
}

function componentItem(component, t) {
  const children = [codeNode(component.shortName || component.name)];

  if (component.shortName && component.shortName !== component.name) {
    children.push(brNode(), emNode(component.name));
  }

  if (component.sdk) {
    children.push(brNode(), ...sdkChipNodes(component.sdk));
  }

  const detailLines = [];
  if (component.type === "activity-alias") {
    detailLines.push(
      t("telegraph.alias_target", {
        target: component.targetActivity || t("telegraph.unknown"),
      }),
    );
  }
  if (component.authorities) {
    detailLines.push(`authorities=${component.authorities}`);
  }
  if (component.permission) {
    detailLines.push(`permission=${component.permission}`);
  }
  if (component.process) {
    detailLines.push(`process=${component.process}`);
  }
  if (component.exported != null) {
    detailLines.push(`exported=${component.exported}`);
  }
  if (component.enabled != null) {
    detailLines.push(`enabled=${component.enabled}`);
  }

  if (detailLines.length > 0) {
    children.push(brNode(), emNode(detailLines.join(" · ")));
  }

  return {
    tag: "li",
    children,
  };
}

function metaDataItem(item, t, scopeLabel = null) {
  const children = [];

  if (scopeLabel) {
    children.push(strongNode(scopeLabel), brNode());
  }

  children.push(codeNode(item.name), " = ", codeNode(item.value || "<empty>"));

  if (item.resolvedFromResource) {
    children.push(brNode(), emNode(t("telegraph.resource_resolved")));
  } else if (item.hasResourceReference) {
    children.push(brNode(), emNode(t("telegraph.resource_reference")));
  }

  return {
    tag: "li",
    children,
  };
}

function buildFeatureChips(report) {
  const buildFeatures = report.apkInfo.buildFeatures;
  const chips = [];

  if (buildFeatures.kotlinDetected) {
    chips.push(
      featureChip(report.featureIcons.kotlin, buildFeatureLabel("Kotlin", buildFeatures.kotlinVersion)),
    );
  }

  if (buildFeatures.composeDetected) {
    chips.push(
      featureChip(report.featureIcons.compose, buildFeatureLabel("Compose", buildFeatures.composeVersion)),
    );
  }

  if (buildFeatures.gradleVersion) {
    chips.push(featureChip(report.featureIcons.gradle, `Gradle ${buildFeatures.gradleVersion}`));
  }

  return chips;
}

function formatIconSummary(report, t) {
  if (!report.apkInfo.icon?.dataUri) {
    return t("telegraph.icon_missing");
  }

  return report.apkInfo.icon.path
    ? t("telegraph.icon_detected_with_path", { path: report.apkInfo.icon.path })
    : t("telegraph.icon_detected");
}

function buildFeatureDetails(buildFeatures, t) {
  const details = [];

  if (buildFeatures.kotlinDetected) {
    details.push(
      textLine(
        `${t("telegraph.feature_kotlin")}: ${buildFeatures.kotlinVersion || t("telegraph.feature_detected")}`,
      ),
    );
  }

  if (buildFeatures.composeDetected) {
    details.push(
      textLine(
        `${t("telegraph.feature_compose")}: ${buildFeatures.composeVersion || t("telegraph.feature_detected")}`,
      ),
    );
  }

  if (buildFeatures.gradleVersion) {
    details.push(textLine(`${t("telegraph.feature_gradle")}: ${buildFeatures.gradleVersion}`));
  }

  if (buildFeatures.agpVersion) {
    details.push(textLine(`${t("telegraph.feature_agp")}: ${buildFeatures.agpVersion}`));
  }

  if (buildFeatures.appMetadataVersion) {
    details.push(
      textLine(
        `${t("telegraph.feature_app_metadata_version")}: ${buildFeatures.appMetadataVersion}`,
      ),
    );
  }

  return details;
}

function sdkSummaryItem(entry) {
  const children = [
    imageNode(entry.iconUrl),
    " ",
    strongNode(entry.label),
    " ",
    codeNode(String(entry.count)),
  ];

  if (entry.detail) {
    children.push(brNode(), emNode(entry.detail));
  }

  if (entry.previewItems?.length > 0) {
    children.push(brNode(), ...codeListNodes(entry.previewItems));
  }

  return {
    tag: "li",
    children,
  };
}

function sdkChipNodes(sdk) {
  return [
    imageNode(sdk.iconUrl),
    " ",
    codeNode(sdk.label),
  ];
}

function codeListNodes(items) {
  const children = [];
  items.forEach((item, index) => {
    if (index > 0) {
      children.push(" ");
    }
    children.push(codeNode(item));
  });
  return children;
}

function textLine(text) {
  return {
    tag: "li",
    children: [text],
  };
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

function getReportStats(report) {
  return report.originalStats || {
    permissions: report.apkInfo.permissions.length,
    nativeLibraries: report.apkInfo.nativeLibraries.length,
    components: countComponents(report.apkInfo.components),
    metaData: countMetaData(report.apkInfo.metaData),
  };
}

function compactReport(report, limits) {
  return {
    ...report,
    isCompacted: true,
    originalStats: getReportStats(report),
    apkInfo: {
      ...report.apkInfo,
      nativeLibraries: report.apkInfo.nativeLibraries.slice(0, limits.nativeLibraries),
      permissions: report.apkInfo.permissions.slice(0, limits.permissions),
      components: {
        activities: report.apkInfo.components.activities.slice(0, limits.componentsPerType),
        services: report.apkInfo.components.services.slice(0, limits.componentsPerType),
        receivers: report.apkInfo.components.receivers.slice(0, limits.componentsPerType),
        providers: report.apkInfo.components.providers.slice(0, limits.componentsPerType),
      },
      metaData: {
        application: report.apkInfo.metaData.application.slice(0, limits.metaData),
        components: [],
      },
      sdkSummary: compactSdkSummary(report.apkInfo.sdkSummary, limits),
    },
  };
}

function buildMinimalReport(report) {
  return compactReport(report, {
    nativeLibraries: 0,
    permissions: 0,
    componentsPerType: 0,
    metaData: 0,
    sdkSummary: 0,
    sdkPreviewItems: 0,
  });
}

function compactSdkSummary(sdkSummary, limits) {
  if (!sdkSummary) {
    return sdkSummary;
  }

  return {
    native: compactSdkSummaryEntries(sdkSummary.native, limits),
    components: compactSdkSummaryEntries(sdkSummary.components, limits),
  };
}

function compactSdkSummaryEntries(entries, limits) {
  return (entries || [])
    .slice(0, limits.sdkSummary)
    .map((entry) => ({
      ...entry,
      detail: entry.detail ? truncateText(entry.detail, 180) : entry.detail,
      previewItems: (entry.previewItems || []).slice(0, limits.sdkPreviewItems),
    }));
}

function paragraph(text) {
  return {
    tag: "p",
    children: [text],
  };
}

function h3(text) {
  return {
    tag: "h3",
    children: [text],
  };
}

function h4(text) {
  return {
    tag: "h4",
    children: [text],
  };
}

function unorderedList(items) {
  return {
    tag: "ul",
    children: items,
  };
}

function chipParagraph(chips) {
  const children = [];
  chips.forEach((chip, index) => {
    if (index > 0) {
      children.push(" ");
    }
    children.push(...chip);
  });

  return {
    tag: "p",
    children,
  };
}

function preBlock(lines) {
  return {
    tag: "pre",
    children: [
      {
        tag: "code",
        children: [lines.join("\n")],
      },
    ],
  };
}

function hrNode() {
  return { tag: "hr" };
}

function brNode() {
  return { tag: "br" };
}

function codeNode(text) {
  return {
    tag: "code",
    children: [text],
  };
}

function imageNode(src) {
  return {
    tag: "img",
    attrs: {
      src,
    },
  };
}

function featureChip(iconUrl, text) {
  return [
    imageNode(iconUrl),
    " ",
    {
      tag: "code",
      children: [text],
    },
  ];
}

function buildFeatureLabel(name, version) {
  return version ? `${name} ${version}` : name;
}

function strongNode(text) {
  return {
    tag: "strong",
    children: [text],
  };
}

function emNode(text) {
  return {
    tag: "em",
    children: [text],
  };
}

function normalizeText(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function truncateText(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
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
