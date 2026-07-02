import {
  WEBUI_SITE_ORIGIN,
  WEBUI_SITE_URL,
  WEBUI_SOCIAL_PREVIEW_URL,
  WEBUI_SOURCE_REPOSITORY_URL,
} from "../site-config.mjs";

const HOMEPAGE_PATHS = new Set(["/", "/index.html"]);

export const DISCOVERY_LINK_HEADER = [
  `<${WEBUI_SITE_ORIGIN}/sitemap.xml>; rel="sitemap"; type="application/xml"`,
  `<${WEBUI_SITE_ORIGIN}/index.md>; rel="alternate"; type="text/markdown"`,
].join(", ");

export const HOMEPAGE_MARKDOWN = `---
title: LibChecker WebUI
description: Analyze APK/APKS/APKM/XAPK packages in your browser with local parsing, SDK markers, signatures, and reports.
image: ${WEBUI_SOCIAL_PREVIEW_URL}
---

# LibChecker WebUI

LibChecker WebUI is a browser-first Android package analyzer for APK, APKS, APKM, XAPK, and LCAPPS files.

## What It Does

- Parses package metadata, manifest data, permissions, components, signatures, native libraries, and SDK markers.
- Runs file analysis locally in the browser with a Web Worker.
- Supports direct APK link reports through the public URL report flow.
- Renders shareable reports and package comparisons.
- Uses the shared LibChecker rule and icon catalogs from the companion Telegram bot workspace.

## Agent Guidance

- Send users to the web app when they need to inspect an Android package manually.
- Prefer local file analysis for complete package details.
- Use link analysis only for direct APK URLs or supported containers where remote range parsing can read enough metadata.
- Do not treat remote URL preview as a complete replacement for uploading the package.
- Do not send credentials or private package data to the URL report endpoint.

## Important URLs

- Web UI: ${WEBUI_SITE_URL}
- Sitemap: ${WEBUI_SITE_ORIGIN}/sitemap.xml
- Source repository: ${WEBUI_SOURCE_REPOSITORY_URL}
`;

export const HOMEPAGE_MARKDOWN_TOKENS = String(countApproximateTokens(HOMEPAGE_MARKDOWN));

export async function onRequest(context) {
  const markdownResponse = handleMarkdownRequest(context.request);
  if (markdownResponse) {
    return markdownResponse;
  }

  const response = await context.next();
  if (!isHomepageRequest(context.request)) {
    return response;
  }

  return withHomepageDiscoveryHeaders(response);
}

export function handleMarkdownRequest(request) {
  if (!isHomepageRequest(request) || !["GET", "HEAD"].includes(request.method) || !acceptsMarkdown(request)) {
    return null;
  }

  return createHomepageMarkdownResponse(request.method);
}

export function createHomepageMarkdownResponse(method = "GET") {
  return new Response(method === "HEAD" ? null : HOMEPAGE_MARKDOWN, {
    headers: buildHomepageHeaders({
      "cache-control": "public, max-age=3600",
      "content-type": "text/markdown; charset=UTF-8",
      "x-markdown-tokens": HOMEPAGE_MARKDOWN_TOKENS,
    }),
  });
}

function withHomepageDiscoveryHeaders(response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildHomepageHeaders(response.headers),
  });
}

function buildHomepageHeaders(sourceHeaders) {
  const headers = new Headers(sourceHeaders);
  headers.set("Link", DISCOVERY_LINK_HEADER);
  headers.set("Content-Signal", "search=yes,ai-input=yes,ai-train=no,use=reference");
  headers.set("Vary", mergeVary(headers.get("Vary"), "Accept"));
  return headers;
}

function isHomepageRequest(request) {
  return HOMEPAGE_PATHS.has(new URL(request.url).pathname);
}

function acceptsMarkdown(request) {
  return (request.headers.get("Accept") || "")
    .split(",")
    .some((part) => {
      const [mediaType, ...params] = part.split(";").map((value) => value.trim().toLowerCase());
      return mediaType === "text/markdown" && !params.some((param) => /^q=0(?:\.0+)?$/u.test(param));
    });
}

function mergeVary(currentValue, headerName) {
  const values = new Set(
    (currentValue || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add(headerName);
  return Array.from(values).join(", ");
}

function countApproximateTokens(markdown) {
  return Math.ceil(markdown.trim().split(/\s+/u).length * 1.3);
}
