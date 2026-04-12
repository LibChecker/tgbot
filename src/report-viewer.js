import { fetchTelegraphPage } from "./telegraph.js";

export async function handleReportRequest(url) {
  const path = url.searchParams.get("path");
  if (!path) {
    return htmlResponse(
      renderErrorPage("缺少 report path 参数。"),
      400,
    );
  }

  try {
    const page = await fetchTelegraphPage(path);
    return htmlResponse(renderReportPage(page), 200);
  } catch (error) {
    return htmlResponse(
      renderErrorPage(getErrorMessage(error)),
      502,
    );
  }
}

function renderReportPage(page) {
  const title = escapeHtml(page.title || "APK 报告");
  const content = renderContent(page.content || []);
  const metaText = buildMetaText(page);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${title}</title>
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
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        background:
          radial-gradient(circle at top right, rgba(59, 130, 246, 0.08), transparent 28rem),
          radial-gradient(circle at top left, rgba(236, 72, 153, 0.08), transparent 24rem),
          var(--bg);
        color: var(--text);
      }

      .page {
        max-width: 880px;
        margin: 0 auto;
        padding: 24px 16px 48px;
      }

      .card {
        background: var(--card);
        border: 1px solid rgba(229, 231, 235, 0.9);
        border-radius: 24px;
        box-shadow: var(--shadow);
        padding: 28px 20px;
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
      }

      .content {
        margin-top: 28px;
      }

      .section + .section {
        margin-top: 30px;
      }

      .section-shell {
        padding: 22px 20px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.92));
        border: 1px solid rgba(229, 231, 235, 0.95);
        border-radius: 22px;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
      }

      .section-body {
        display: grid;
        gap: 16px;
      }

      h3, h4 {
        color: #111827;
        letter-spacing: -0.02em;
      }

      h3 {
        margin: 0 0 16px;
        font-size: 1.75rem;
      }

      h4 {
        margin: 20px 0 12px;
        font-size: 1.15rem;
      }

      p, li {
        font-size: 1rem;
        line-height: 1.8;
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
        padding: 16px 18px;
        background: var(--soft);
        border: 1px solid var(--line);
        border-radius: 18px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }

      code {
        font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
        font-size: 0.94em;
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

      p code {
        margin-right: 10px;
      }

      .kv-card {
        display: grid;
        gap: 10px;
        padding: 18px;
        background:
          linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.96));
        border: 1px solid var(--line);
        border-radius: 18px;
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
        gap: 12px;
        margin: 0 0 18px;
      }

      .feature-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: linear-gradient(180deg, #ffffff, #f8fafc);
        border: 1px solid var(--line);
        border-radius: 999px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        font-weight: 600;
      }

      .feature-pill code {
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
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }

      .group-grid.group-grid--single {
        grid-template-columns: 1fr;
      }

      .group-card,
      .list-panel {
        padding: 18px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(248, 250, 252, 0.96));
        border: 1px solid var(--line);
        border-radius: 18px;
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
        padding: 14px 14px 12px;
        background: rgba(248, 250, 252, 0.9);
        border: 1px solid rgba(229, 231, 235, 0.9);
        border-radius: 16px;
      }

      .item-line + .item-line {
        margin-top: 8px;
      }

      .item-title {
        font-weight: 700;
        color: #0f172a;
      }

      .item-subtitle {
        color: #475569;
      }

      .item-meta {
        color: var(--muted);
        font-size: 0.95rem;
      }

      .chip-cloud {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .chip-cloud code {
        margin: 0;
        padding: 0.36em 0.72em;
      }

      .sdk-chart {
        display: grid;
        gap: 14px;
      }

      .sdk-chart-row {
        padding: 16px;
        background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.96));
        border: 1px solid rgba(229, 231, 235, 0.95);
        border-radius: 18px;
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
        margin: 0;
        padding: 0.32em 0.7em;
      }

      a {
        color: #2563eb;
      }

      @media (max-width: 640px) {
        .page {
          padding: 12px 10px 24px;
        }

        .card {
          border-radius: 18px;
          padding: 22px 14px;
        }

        h3 {
          font-size: 1.5rem;
        }

        .kv-row {
          grid-template-columns: 1fr;
          gap: 4px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <article class="card">
        <h1>${title}</h1>
        <div class="meta">${escapeHtml(metaText)}</div>
        <section class="content">${content}</section>
      </article>
    </main>
  </body>
</html>`;
}

function renderErrorPage(message) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>报告加载失败</title>
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

      .panel {
        max-width: 520px;
        padding: 28px 24px;
        background: #fff;
        border: 1px solid #e5e7eb;
        border-radius: 20px;
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
      <h1>报告加载失败</h1>
      <p>${escapeHtml(message)}</p>
    </section>
  </body>
</html>`;
}

function buildMetaText(page) {
  const parts = [];
  if (page.author_name) {
    parts.push(page.author_name);
  }
  if (page.views != null) {
    parts.push(`浏览 ${page.views}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "APK 解析报告";
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
    sectionTitle === "组件" ? "group-grid group-grid--single" : "group-grid";
  return `<div class="${className}">${cards.join("")}</div>`;
}

function renderGroupCard(headingNode, bodyNodes) {
  const title = extractText(headingNode?.children || []).trim();
  const className =
    title.includes("SDK 标记") || title.includes("已标记的 SDK")
      ? "group-card group-card--wide"
      : "group-card";
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

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "未知错误";
}
