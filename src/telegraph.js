const TELEGRAPH_API_BASE = "https://api.telegra.ph";

let cachedAccessToken = null;

export async function createApkTelegraphPage(env, report) {
  const accessToken = await getTelegraphAccessToken(env);
  const content = buildTelegraphContent(report);
  return telegraphApi("createPage", {
    access_token: accessToken,
    title: buildPageTitle(report),
    author_name: getAuthorName(env),
    author_url: normalizeText(env.TELEGRAPH_AUTHOR_URL) || undefined,
    content: JSON.stringify(content),
    return_content: false,
  });
}

export async function fetchTelegraphPage(path) {
  const normalizedPath = normalizeTelegraphPath(path);
  if (!normalizedPath) {
    throw new Error("Telegraph 页面路径无效");
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
    throw new Error(`Telegraph 页面获取失败 (${response.status})`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || "Telegraph 页面获取失败");
  }

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

  const account = await telegraphApi("createAccount", {
    short_name: normalizeShortName(env.TELEGRAPH_SHORT_NAME) || "tgbot",
    author_name: getAuthorName(env),
    author_url: normalizeText(env.TELEGRAPH_AUTHOR_URL) || undefined,
  });

  cachedAccessToken = account.access_token;
  return cachedAccessToken;
}

async function telegraphApi(method, payload) {
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
    throw new Error(`Telegraph API ${method} 请求失败 (${response.status})`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || `Telegraph API ${method} 返回失败`);
  }

  return data.result;
}

function buildPageTitle(report) {
  return truncateText(`${report.apkInfo.appName} APK 信息`, 256);
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

function buildTelegraphContent(report) {
  const featureChips = buildFeatureChips(report);
  const featureDetails = buildFeatureDetails(report.apkInfo.buildFeatures);
  const sections = [
    h3("APK 摘要"),
    preBlock([
      `应用: ${report.apkInfo.appName}`,
      `包名: ${report.apkInfo.packageName}`,
      `版本: ${report.apkInfo.versionName} (${report.apkInfo.versionCode})`,
      `SDK: Target ${report.apkInfo.targetSdk} / Min ${report.apkInfo.minSdk} / Compile ${report.apkInfo.compileSdk}`,
      `统计: 权限 ${report.apkInfo.permissions.length} · 原生库 ${report.apkInfo.nativeLibraries.length} · 组件 ${countComponents(report.apkInfo.components)} · meta-data ${countMetaData(report.apkInfo.metaData)}`,
    ]),
    h3("文件信息"),
    preBlock([
      `文件名: ${report.fileName}`,
      `文件大小: ${report.fileSizeText}`,
      `消息来源: ${report.sourceLabel}`,
      `分析时间: ${report.analyzedAt}`,
    ]),
    hrNode(),
    h3("原生库"),
  ];

  if (featureChips.length > 0 || featureDetails.length > 0) {
    sections.splice(
      2,
      0,
      ...(featureChips.length > 0 ? [chipParagraph(featureChips)] : []),
      hrNode(),
      h3("构建特性"),
      ...(featureDetails.length > 0
        ? [unorderedList(featureDetails)]
        : [paragraph("未识别到构建特性。")]),
      hrNode(),
    );
  }

  pushNativeLibraries(sections, report.apkInfo.nativeLibraries);

  sections.push(hrNode(), h3("权限"));
  pushPermissions(sections, report.apkInfo.permissions);

  sections.push(hrNode(), h3("组件"));
  pushComponentSection(sections, "Activity", report.apkInfo.components.activities);
  pushComponentSection(sections, "Service", report.apkInfo.components.services);
  pushComponentSection(sections, "Receiver", report.apkInfo.components.receivers);
  pushComponentSection(sections, "Provider", report.apkInfo.components.providers);

  sections.push(hrNode(), h3("Application Meta-Data"));
  pushMetaDataSection(sections, report.apkInfo.metaData.application);

  return sections;
}

function pushNativeLibraries(sections, libraries) {
  if (libraries.length === 0) {
    sections.push(paragraph("未发现原生库。"));
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

function pushPermissions(sections, permissions) {
  if (permissions.length === 0) {
    sections.push(paragraph("未声明权限。"));
    return;
  }

  sections.push(unorderedList(permissions.map((permission) => permissionItem(permission))));
}

function pushComponentSection(sections, title, components) {
  sections.push(h4(`${title} (${components.length})`));

  if (components.length === 0) {
    sections.push(paragraph(`未声明 ${title}。`));
    return;
  }

  sections.push(unorderedList(components.map((component) => componentItem(component))));
}

function pushMetaDataSection(sections, metaDataItems) {
  if (metaDataItems.length === 0) {
    sections.push(paragraph("未声明 application 级 meta-data。"));
    return;
  }

  sections.push(unorderedList(metaDataItems.map((item) => metaDataItem(item))));
}

function nativeLibraryItem(library) {
  return {
    tag: "li",
    children: [
      codeNode(library.name),
      brNode(),
      emNode(`${formatBytes(library.size)} · ${library.path}`),
    ],
  };
}

function permissionItem(permission) {
  return {
    tag: "li",
    children: [codeNode(permission)],
  };
}

function componentItem(component) {
  const children = [codeNode(component.shortName || component.name)];

  if (component.shortName && component.shortName !== component.name) {
    children.push(brNode(), emNode(component.name));
  }

  const detailLines = [];
  if (component.type === "activity-alias") {
    detailLines.push(`alias -> ${component.targetActivity || "未知"}`);
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

function metaDataItem(item, scopeLabel = null) {
  const children = [];

  if (scopeLabel) {
    children.push(strongNode(scopeLabel), brNode());
  }

  children.push(codeNode(item.name), " = ", codeNode(item.value || "<empty>"));

  if (item.resolvedFromResource) {
    children.push(brNode(), emNode("resolved from string resource"));
  } else if (item.hasResourceReference) {
    children.push(brNode(), emNode("resource reference"));
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

function buildFeatureDetails(buildFeatures) {
  const details = [];

  if (buildFeatures.kotlinDetected) {
    details.push(textLine(`Kotlin: ${buildFeatures.kotlinVersion || "已检测到"}`));
  }

  if (buildFeatures.composeDetected) {
    details.push(textLine(`Compose: ${buildFeatures.composeVersion || "已检测到"}`));
  }

  if (buildFeatures.gradleVersion) {
    details.push(textLine(`Gradle: ${buildFeatures.gradleVersion}`));
  }

  if (buildFeatures.agpVersion) {
    details.push(textLine(`Android Gradle Plugin: ${buildFeatures.agpVersion}`));
  }

  if (buildFeatures.appMetadataVersion) {
    details.push(textLine(`App Metadata Version: ${buildFeatures.appMetadataVersion}`));
  }

  return details;
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
