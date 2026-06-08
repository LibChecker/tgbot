import { createI18n, normalizeLocale } from "./i18n.js";
import { fetchTelegraphPage } from "./telegraph.js";

export async function handleReportRequest(url) {
  const locale = normalizeLocale(url.searchParams.get("lang"));
  const { t } = createI18n(locale);
  const path = url.searchParams.get("path");
  if (!path) {
    return htmlResponse(
      renderErrorPage(t("report.missing_path"), locale),
      400,
    );
  }

  try {
    const page = await fetchTelegraphPage(path, locale);
    return htmlResponse(renderReportPage(page, locale), 200);
  } catch (error) {
    return htmlResponse(
      renderErrorPage(getErrorMessage(error, t), locale),
      502,
    );
  }
}

function renderReportPage(page, locale) {
  const { t, languageTag } = createI18n(locale);
  const titleText = page.title || t("report.fallback_title");
  const rawContent = page.content || [];
  const appIconDataUri = extractAppIconDataUri(rawContent);
  const content = renderContent(stripAppIconDataMarkers(rawContent));
  const metaText = buildMetaText(page, t);
  const reportHero = renderReportHero(titleText, metaText, appIconDataUri);

  return `<!doctype html>
<html lang="${escapeHtml(languageTag)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(titleText)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f6fb;
        --card: #ffffff;
        --text: #1f2937;
        --muted: #6b7280;
        --line: #e5e7eb;
        --soft: #f8fafc;
        --code-bg: #f3f4f6;
        --shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
        --corner-curve: squircle;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
        corner-shape: var(--corner-curve);
      }

      html {
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
      }

      body {
        margin: 0;
        min-height: 100vh;
        width: 100%;
        max-width: 100%;
        overflow-x: clip;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(59, 130, 246, 0.08), transparent 28rem),
          radial-gradient(circle at top left, rgba(236, 72, 153, 0.08), transparent 24rem),
          var(--bg);
        color: var(--text);
      }

      .page {
        width: min(1160px, calc(100% - clamp(20px, 4vw, 56px)));
        margin: 0 auto;
        padding: clamp(16px, 3vw, 28px) 0 clamp(32px, 5vw, 56px);
      }

      .card {
        background: var(--card);
        border: 1px solid rgba(229, 231, 235, 0.9);
        border-radius: 28px;
        box-shadow: var(--shadow);
        padding: clamp(20px, 3vw, 34px) clamp(16px, 3vw, 30px);
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 2.9rem);
        line-height: 1.15;
        letter-spacing: -0.03em;
      }

      .meta {
        margin-top: 10px;
        color: var(--muted);
        font-size: 0.95rem;
        overflow-wrap: anywhere;
      }

      .report-hero {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: clamp(14px, 2.4vw, 24px);
      }

      .report-hero--plain {
        display: block;
      }

      .report-hero__text {
        min-width: 0;
      }

      .app-icon {
        width: clamp(72px, 10vw, 104px);
        height: clamp(72px, 10vw, 104px);
        margin: 0;
        border-radius: 50%;
        object-fit: contain;
        filter: drop-shadow(0 18px 28px rgba(15, 23, 42, 0.16));
      }

      .content,
      .section,
      .section-shell,
      .section-body,
      .group-grid,
      .group-card,
      .list-panel,
      .list-item,
      .item-line,
      .kv-card,
      .kv-row,
      .sdk-chart,
      .sdk-chart-row,
      .sdk-chart-header,
      .sdk-chart-title,
      .sdk-chart-label,
      .sdk-chart-meta,
      .sdk-chart-preview {
        min-width: 0;
        max-width: 100%;
      }

      .content {
        margin-top: clamp(22px, 3vw, 32px);
      }

      .section + .section {
        margin-top: clamp(22px, 3vw, 32px);
      }

      .section-shell {
        padding: clamp(18px, 2.4vw, 26px) clamp(16px, 2.2vw, 24px);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.92));
        border: 1px solid rgba(229, 231, 235, 0.95);
        border-radius: 26px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
      }

      .section-body {
        display: grid;
        gap: clamp(14px, 2vw, 18px);
      }

      h3, h4 {
        color: #111827;
        letter-spacing: -0.02em;
      }

      h3 {
        margin: 0 0 16px;
        font-size: clamp(1.5rem, 2vw, 1.85rem);
      }

      h4 {
        margin: 20px 0 12px;
        font-size: 1.15rem;
      }

      p, li {
        font-size: clamp(0.98rem, 0.2vw + 0.95rem, 1.04rem);
        line-height: 1.8;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      p {
        margin: 0 0 14px;
      }

      ul {
        margin: 0 0 8px 0;
        padding-left: 1.4rem;
      }

      li + li {
        margin-top: 10px;
      }

      hr {
        border: 0;
        border-top: 1px solid var(--line);
        margin: 28px 0;
      }

      pre {
        margin: 0 0 18px;
        padding: clamp(14px, 2vw, 18px) clamp(14px, 2vw, 18px);
        background: var(--soft);
        border: 1px solid var(--line);
        border-radius: 22px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }

      code {
        display: inline;
        max-width: 100%;
        font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
        font-size: 0.94em;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        background: var(--code-bg);
        border-radius: 999px;
        padding: 0.16em 0.5em;
      }

      pre code {
        display: block;
        padding: 0;
        background: transparent;
        border-radius: 0;
        line-height: 1.8;
      }

      em {
        color: var(--muted);
      }

      img {
        display: inline-block;
        width: 18px;
        height: 18px;
        vertical-align: -3px;
        margin-right: 6px;
      }

      figure {
        display: inline-grid;
        place-items: center;
        gap: 8px;
        margin: 0 0 18px;
        padding: 14px;
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        border: 1px solid var(--line);
        border-radius: 26px;
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
      }

      figure img {
        width: clamp(64px, 12vw, 88px);
        height: clamp(64px, 12vw, 88px);
        margin: 0;
        border-radius: 26%;
        object-fit: contain;
      }

      figcaption {
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.4;
      }

      p code {
        margin-right: 10px;
      }

      .kv-card {
        display: grid;
        gap: 10px;
        padding: clamp(14px, 2vw, 18px);
        background:
          linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.96));
        border: 1px solid var(--line);
        border-radius: 22px;
      }

      .kv-row {
        display: grid;
        grid-template-columns: minmax(88px, 120px) 1fr;
        gap: 10px;
        align-items: start;
      }

      .kv-label {
        font-size: 0.92rem;
        font-weight: 700;
        color: var(--muted);
      }

      .kv-value {
        min-width: 0;
        line-height: 1.7;
        word-break: break-word;
      }

      .feature-grid {
        display: flex;
        flex-wrap: wrap;
        gap: clamp(10px, 1.8vw, 14px);
        margin: 0 0 18px;
      }

      .feature-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: 100%;
        min-width: 0;
        padding: 10px 14px;
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        border: 1px solid var(--line);
        border-radius: 999px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        font-weight: 600;
      }

      .feature-pill code {
        display: inline;
        margin: 0;
        padding: 0;
        background: transparent;
        border-radius: 0;
        font-size: 0.98rem;
      }

      .feature-pill img {
        margin: 0;
      }

      .bullet-card {
        padding: 6px 0 0;
      }

      .bullet-card ul {
        padding-left: 1.2rem;
      }

      .group-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
      }

      .group-grid.group-grid--single {
        grid-template-columns: 1fr;
      }

      .group-card,
      .list-panel {
        padding: clamp(14px, 2vw, 18px);
        background: linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(248, 250, 252, 0.96));
        border: 1px solid var(--line);
        border-radius: 22px;
      }

      .group-card.group-card--wide {
        grid-column: 1 / -1;
      }

      .group-card h4 {
        margin-top: 0;
      }

      .group-card .list-panel {
        padding: 0;
        background: transparent;
        border: 0;
        border-radius: 0;
      }

      .list-panel {
        display: grid;
        gap: 12px;
      }

      .list-item {
        padding: clamp(12px, 1.8vw, 14px) clamp(12px, 1.8vw, 14px) clamp(10px, 1.4vw, 12px);
        background: rgba(248, 250, 252, 0.9);
        border: 1px solid rgba(229, 231, 235, 0.9);
        border-radius: 20px;
        font-size: 0.92rem;
        line-height: 1.62;
      }

      .item-line + .item-line {
        margin-top: 8px;
      }

      .item-title {
        font-size: 0.95rem;
        font-weight: 700;
        color: #0f172a;
      }

      .item-subtitle {
        font-size: 0.9rem;
        color: #475569;
      }

      .item-meta {
        color: var(--muted);
        font-size: 0.86rem;
      }

      .list-item code {
        font-size: 0.9em;
      }

      .item-line,
      .item-line code,
      .item-line a,
      .kv-value,
      .kv-value code,
      .sdk-chart-label,
      .sdk-chart-meta,
      .sdk-chart-meta code {
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .chip-cloud {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .chip-cloud code {
        display: inline-block;
        max-width: 100%;
        margin: 0;
        padding: 0.36em 0.72em;
      }

      .sdk-chart {
        display: grid;
        gap: 14px;
      }

      .sdk-chart-row {
        padding: clamp(14px, 2vw, 18px);
        background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.96));
        border: 1px solid rgba(229, 231, 235, 0.95);
        border-radius: 22px;
      }

      .sdk-chart-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .sdk-chart-title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-weight: 700;
        color: #0f172a;
      }

      .sdk-chart-title img {
        flex: 0 0 auto;
        margin: 0;
      }

      .sdk-chart-label {
        min-width: 0;
        word-break: break-word;
      }

      .sdk-chart-count {
        flex: 0 0 auto;
        padding: 0.2em 0.65em;
        border-radius: 999px;
        background: var(--code-bg);
        font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
        font-size: 0.95rem;
      }

      .sdk-chart-bar-shell {
        margin-top: 12px;
        height: 10px;
        background: rgba(226, 232, 240, 0.9);
        border-radius: 999px;
        overflow: hidden;
      }

      .sdk-chart-bar {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #1d4ed8, #0ea5e9);
      }

      .sdk-chart-meta {
        margin-top: 10px;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.7;
      }

      .sdk-chart-preview {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .sdk-chart-preview code {
        display: inline-block;
        max-width: 100%;
        margin: 0;
        padding: 0.32em 0.7em;
      }

      a {
        color: #2563eb;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      @media (max-width: 900px) {
        .sdk-chart-header {
          flex-wrap: wrap;
          align-items: flex-start;
        }

        .sdk-chart-count {
          margin-left: auto;
        }
      }

      @media (max-width: 640px) {
        .page {
          width: min(calc(100% - 16px), 100%);
          padding: 8px 0 20px;
        }

        .card {
          border-radius: 22px;
          padding: 18px 12px;
        }

        .report-hero {
          align-items: flex-start;
          gap: 12px;
        }

        .app-icon {
          width: 68px;
          height: 68px;
        }

        h1 {
          font-size: clamp(1.75rem, 8vw, 2.25rem);
        }

        h3 {
          font-size: 1.5rem;
        }

        h4 {
          font-size: 1.06rem;
        }

        .kv-row {
          grid-template-columns: 1fr;
          gap: 4px;
        }

        .feature-pill {
          width: 100%;
          justify-content: flex-start;
          align-items: flex-start;
          border-radius: 22px;
        }

        .feature-pill img {
          margin-top: 2px;
        }

        .group-grid {
          grid-template-columns: 1fr;
        }

        .sdk-chart-header {
          gap: 10px;
        }

        .sdk-chart-count {
          margin-left: 0;
        }

        .chip-cloud,
        .sdk-chart-preview {
          gap: 6px;
        }

        .chip-cloud code,
        .sdk-chart-preview code {
          width: 100%;
          border-radius: 18px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <article class="card">
        ${reportHero}
        <section class="content">${content}</section>
      </article>
    </main>
  </body>
</html>`;
}

function renderErrorPage(message, locale) {
  const { t, languageTag } = createI18n(locale);
  return `<!doctype html>
<html lang="${escapeHtml(languageTag)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escapeHtml(t("report.error_title"))}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f4f6fb;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #1f2937;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
        corner-shape: squircle;
      }

      .panel {
        width: min(520px, calc(100vw - 28px));
        padding: clamp(22px, 3vw, 28px) clamp(18px, 3vw, 24px);
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 24px;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
      }

      h1 {
        margin: 0 0 12px;
        font-size: 1.4rem;
      }

      p {
        margin: 0;
        line-height: 1.7;
        color: #6b7280;
      }
    </style>
  </head>
  <body>
    <section class="panel">
      <h1>${escapeHtml(t("report.error_title"))}</h1>
      <p>${escapeHtml(message)}</p>
    </section>
  </body>
</html>`;
}

function buildMetaText(page, t) {
  const parts = [];
  if (page.author_name) {
    parts.push(page.author_name);
  }
  if (page.views != null) {
    parts.push(t("report.views", { count: page.views }));
  }
  return parts.length > 0 ? parts.join(" · ") : t("report.meta_fallback");
}

const APP_ICON_DATA_PREFIX = "LC_APP_ICON_DATA:";

function extractAppIconDataUri(nodes) {
  for (const node of nodes || []) {
    const dataUri = getAppIconMarkerDataUri(node);
    if (dataUri) {
      return dataUri;
    }
  }

  return null;
}

function stripAppIconDataMarkers(nodes) {
  return (nodes || []).filter((node) => !getAppIconMarkerDataUri(node));
}

function getAppIconMarkerDataUri(node) {
  if (!node || typeof node !== "object" || !["aside", "p", "pre"].includes(node.tag)) {
    return null;
  }

  const text = extractText(node.children || []).trim();
  if (!text.startsWith(APP_ICON_DATA_PREFIX)) {
    return null;
  }

  const dataUri = text.slice(APP_ICON_DATA_PREFIX.length).trim();
  return isSafeAppIconDataUri(dataUri) ? dataUri : null;
}

function isSafeAppIconDataUri(value) {
  return /^data:image\/(?:png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+$/u.test(value);
}

function renderReportHero(title, metaText, dataUri) {
  const icon = dataUri
    ? `<img class="app-icon" src="${escapeHtml(dataUri)}" alt="" loading="lazy">`
    : "";
  const className = dataUri ? "report-hero" : "report-hero report-hero--plain";

  return [
    `<header class="${className}">`,
    icon,
    '<div class="report-hero__text">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<div class="meta">${escapeHtml(metaText)}</div>`,
    "</div>",
    "</header>",
  ].join("");
}

function renderContent(nodes) {
  const blocks = [];
  let current = [];

  for (const node of nodes) {
    if (isHrNode(node)) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }

    current.push(node);
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks
    .map((block) => `<section class="section">${renderSection(block)}</section>`)
    .join("");
}

function renderSection(nodes) {
  const [headingNode, ...bodyNodes] = nodes;

  if (headingNode?.tag === "h3") {
    const sectionTitle = extractText(headingNode.children || []).trim();
    return [
      '<div class="section-shell">',
      renderNode(headingNode),
      `<div class="section-body">${renderSectionBody(bodyNodes, sectionTitle)}</div>`,
      "</div>",
    ].join("");
  }

  return `<div class="section-shell"><div class="section-body">${renderSectionBody(nodes, "")}</div></div>`;
}

function renderSectionBody(nodes, sectionTitle) {
  const parts = [];
  const groupCards = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];

    if (node?.tag === "h4") {
      const groupNodes = [];
      let cursor = index + 1;
      while (cursor < nodes.length && nodes[cursor]?.tag !== "h4") {
        groupNodes.push(nodes[cursor]);
        cursor += 1;
      }

      groupCards.push(renderGroupCard(node, groupNodes));
      index = cursor - 1;
      continue;
    }

    if (groupCards.length > 0) {
      parts.push(renderGroupGrid(groupCards, sectionTitle));
      groupCards.length = 0;
    }

    parts.push(renderBodyNode(node));
  }

  if (groupCards.length > 0) {
    parts.push(renderGroupGrid(groupCards, sectionTitle));
  }

  return parts.join("");
}

function renderGroupGrid(cards, sectionTitle) {
  const className =
    isComponentSectionTitle(sectionTitle) ? "group-grid group-grid--single" : "group-grid";
  return `<div class="${className}">${cards.join("")}</div>`;
}

function renderGroupCard(headingNode, bodyNodes) {
  const title = extractText(headingNode?.children || []).trim();
  const className = isWideGroupTitle(title) ? "group-card group-card--wide" : "group-card";
  return [
    `<article class="${className}">`,
    renderNode(headingNode),
    bodyNodes.map((node) => renderBodyNode(node)).join(""),
    "</article>",
  ].join("");
}

function renderBodyNode(node) {
  if (node?.tag === "ul") {
    return renderListNode(node);
  }

  return renderNode(node);
}

function renderNodes(nodes) {
  return nodes.map((node) => renderNode(node)).join("");
}

function renderNode(node) {
  if (typeof node === "string") {
    return escapeHtml(node);
  }

  if (!node || typeof node !== "object" || !node.tag) {
    return "";
  }

  const tag = normalizeTag(node.tag);
  if (!tag) {
    return "";
  }

  if (tag === "pre") {
    return renderPreNode(node);
  }

  if (tag === "p" && isFeatureChipParagraph(node)) {
    return renderFeatureChipParagraph(node);
  }

  const attrs = renderAttributes(node.attrs || {}, tag);
  const content = renderNodes(node.children || []);

  if (tag === "br" || tag === "hr" || tag === "img") {
    return `<${tag}${attrs}>`;
  }

  return `<${tag}${attrs}>${content}</${tag}>`;
}

function renderPreNode(node) {
  const lines = getPreLines(node);
  if (lines.length === 0) {
    return "<pre></pre>";
  }

  const rows = lines.map((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      return `<div class="kv-row"><div class="kv-value">${escapeHtml(line)}</div></div>`;
    }

    const label = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    return [
      '<div class="kv-row">',
      `<div class="kv-label">${escapeHtml(label)}</div>`,
      `<div class="kv-value">${escapeHtml(value)}</div>`,
      "</div>",
    ].join("");
  });

  return `<div class="kv-card">${rows.join("")}</div>`;
}

function renderFeatureChipParagraph(node) {
  const chips = parseFeatureChips(node);
  if (chips.length === 0) {
    return renderPlainParagraph(node);
  }

  return [
    '<div class="feature-grid">',
    chips.map((chip) => renderFeatureChip(chip)).join(""),
    "</div>",
  ].join("");
}

function renderFeatureChip(chip) {
  return [
    '<div class="feature-pill">',
    chip.iconUrl ? `<img src="${escapeHtml(chip.iconUrl)}" alt="" loading="lazy">` : "",
    `<code>${escapeHtml(chip.label)}</code>`,
    "</div>",
  ].join("");
}

function renderPlainParagraph(node) {
  const attrs = renderAttributes(node.attrs || {}, "p");
  const content = renderNodes(node.children || []);
  return `<p${attrs}>${content}</p>`;
}

function renderListNode(node) {
  if (isSdkSummaryList(node)) {
    return renderSdkSummaryList(node);
  }

  if (isCodeOnlyList(node)) {
    return renderChipCloud(node);
  }

  if (isSimpleTextList(node)) {
    return `<div class="bullet-card">${renderSimpleTextList(node)}</div>`;
  }

  return renderListPanel(node);
}

function renderListPanel(node) {
  const items = (node.children || [])
    .filter((child) => child?.tag === "li")
    .map((child) => renderListItem(child))
    .join("");

  return `<div class="list-panel">${items}</div>`;
}

function renderListItem(node) {
  const lines = splitChildrenByBreaks(node.children || []).filter((line) => line.length > 0);
  const content = lines.map((line, index) => renderItemLine(line, index)).join("");
  return `<article class="list-item">${content}</article>`;
}

function renderItemLine(line, index) {
  const className =
    index === 0 ? "item-line item-title" : index === 1 ? "item-line item-subtitle" : "item-line item-meta";
  return `<div class="${className}">${renderNodes(line)}</div>`;
}

function renderChipCloud(node) {
  const chips = (node.children || [])
    .filter((child) => child?.tag === "li")
    .map((child) => {
      const codeNode = (child.children || []).find((part) => part?.tag === "code");
      const label = extractText(codeNode?.children || []).trim();
      return label ? `<code>${escapeHtml(label)}</code>` : "";
    })
    .filter(Boolean)
    .join("");

  return `<div class="chip-cloud">${chips}</div>`;
}

function renderSdkSummaryList(node) {
  const items = parseSdkSummaryItems(node);
  if (items.length === 0) {
    return renderListPanel(node);
  }

  const maxCount = Math.max(...items.map((item) => item.count), 1);
  return [
    '<div class="sdk-chart">',
    items.map((item) => renderSdkSummaryRow(item, maxCount)).join(""),
    "</div>",
  ].join("");
}

function renderSdkSummaryRow(item, maxCount) {
  const width = Math.max(12, Math.round((item.count / maxCount) * 100));
  return [
    '<article class="sdk-chart-row">',
    '<div class="sdk-chart-header">',
    '<div class="sdk-chart-title">',
    item.iconUrl ? `<img src="${escapeHtml(item.iconUrl)}" alt="" loading="lazy">` : "",
    `<span class="sdk-chart-label">${escapeHtml(item.label)}</span>`,
    "</div>",
    `<span class="sdk-chart-count">${escapeHtml(String(item.count))}</span>`,
    "</div>",
    `<div class="sdk-chart-bar-shell"><div class="sdk-chart-bar" style="width:${width}%"></div></div>`,
    item.detail ? `<div class="sdk-chart-meta">${escapeHtml(item.detail)}</div>` : "",
    item.preview.length > 0
      ? `<div class="sdk-chart-preview">${item.preview.map((value) => `<code>${escapeHtml(value)}</code>`).join("")}</div>`
      : "",
    "</article>",
  ].join("");
}

function renderSimpleTextList(node) {
  const items = (node.children || [])
    .filter((child) => child?.tag === "li")
    .map((child) => `<li>${renderNodes(child.children || [])}</li>`)
    .join("");

  return `<ul>${items}</ul>`;
}

function normalizeTag(tag) {
  const allowedTags = new Set([
    "a",
    "aside",
    "blockquote",
    "br",
    "code",
    "em",
    "figcaption",
    "figure",
    "h3",
    "h4",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "u",
    "ul",
  ]);

  return allowedTags.has(tag) ? tag : null;
}

function renderAttributes(attrs, tag) {
  const rendered = [];

  if (tag === "a" && attrs.href) {
    rendered.push(` href="${escapeHtml(attrs.href)}"`);
    rendered.push(' target="_blank" rel="noreferrer noopener"');
  }

  if (tag === "img" && attrs.src) {
    rendered.push(` src="${escapeHtml(attrs.src)}"`);
    rendered.push(' alt="" loading="lazy"');
  }

  return rendered.join("");
}

function isHrNode(node) {
  return Boolean(node && typeof node === "object" && node.tag === "hr");
}

function isFeatureChipParagraph(node) {
  if (!node || node.tag !== "p") {
    return false;
  }

  return parseFeatureChips(node).length > 0;
}

function parseFeatureChips(node) {
  const chips = [];
  const children = Array.isArray(node.children) ? node.children : [];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child?.tag !== "img") {
      continue;
    }

    const nextNode = findNextNonWhitespaceNode(children, index + 1);
    if (!nextNode || nextNode.tag !== "code") {
      continue;
    }

    const label = extractText(nextNode.children || []).trim();
    if (!label) {
      continue;
    }

    chips.push({
      iconUrl: child.attrs?.src || "",
      label,
    });
  }

  return chips;
}

function findNextNonWhitespaceNode(nodes, startIndex) {
  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (typeof node === "string" && node.trim() === "") {
      continue;
    }
    return node;
  }

  return null;
}

function isSimpleTextList(node) {
  if (!node || node.tag !== "ul") {
    return false;
  }

  return (node.children || []).every((child) => {
    if (!child || child.tag !== "li") {
      return false;
    }

    return isPlainTextOnly(child.children || []);
  });
}

function isSdkSummaryList(node) {
  if (!node || node.tag !== "ul") {
    return false;
  }

  const items = parseSdkSummaryItems(node);
  const listItems = (node.children || []).filter((child) => child?.tag === "li");
  return listItems.length > 0 && items.length === listItems.length;
}

function parseSdkSummaryItems(node) {
  return (node.children || [])
    .filter((child) => child?.tag === "li")
    .map((child) => parseSdkSummaryItem(child))
    .filter(Boolean);
}

function parseSdkSummaryItem(node) {
  const lines = splitChildrenByBreaks(node.children || []).filter((line) => line.length > 0);
  const firstLine = lines[0] || [];
  const iconNode = firstLine.find((part) => part?.tag === "img") || null;
  const labelNode = firstLine.find((part) => part?.tag === "strong") || null;
  const countNode = firstLine.find((part) => part?.tag === "code") || null;
  const label = extractText(labelNode?.children || []).trim();
  const countText = extractText(countNode?.children || []).trim();
  const count = Number.parseInt(countText, 10);

  if (!label || Number.isNaN(count)) {
    return null;
  }

  return {
    iconUrl: iconNode?.attrs?.src || "",
    label,
    count,
    detail: extractText(lines[1] || []).trim(),
    preview: parseSdkPreviewLine(lines[2] || []),
  };
}

function parseSdkPreviewLine(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const codes = nodes
    .filter((node) => node?.tag === "code")
    .map((node) => extractText(node.children || []).trim())
    .filter(Boolean);
  if (codes.length > 0) {
    return codes;
  }

  const text = extractText(nodes).trim();
  return text ? [text] : [];
}

function isCodeOnlyList(node) {
  if (!node || node.tag !== "ul") {
    return false;
  }

  return (node.children || []).every((child) => {
    if (!child || child.tag !== "li") {
      return false;
    }

    const parts = child.children || [];
    return parts.length === 1 && parts[0]?.tag === "code";
  });
}

function isPlainTextOnly(nodes) {
  return nodes.every((node) => {
    if (typeof node === "string") {
      return true;
    }

    return node?.tag === "br";
  });
}

function getPreLines(node) {
  const codeNode = (node.children || []).find((child) => child?.tag === "code");
  if (!codeNode) {
    return [];
  }

  return extractText(codeNode.children || [])
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractText(nodes) {
  return nodes
    .map((node) => {
      if (typeof node === "string") {
        return node;
      }

      if (!node || typeof node !== "object") {
        return "";
      }

      if (node.tag === "br") {
        return "\n";
      }

      return extractText(node.children || []);
    })
    .join("");
}

function splitChildrenByBreaks(nodes) {
  const lines = [];
  let current = [];

  for (const node of nodes) {
    if (node?.tag === "br") {
      lines.push(current);
      current = [];
      continue;
    }

    current.push(node);
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function htmlResponse(html, status) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getErrorMessage(error, t) {
  if (error instanceof Error) {
    return error.message;
  }

  return t("errors.unknown");
}

function isComponentSectionTitle(title) {
  const normalized = title.trim().toLowerCase();
  return normalized === "组件" || normalized === "components";
}

function isWideGroupTitle(title) {
  return title.trim().toLowerCase().includes("sdk");
}
