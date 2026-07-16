import {
  resolveWebUiSiteConfig,
  WEBUI_SITE_DESCRIPTION,
  WEBUI_SITE_NAME,
} from "../site-config.mjs";

const HOMEPAGE_PATHS = new Set(["/", "/index.html"]);

export const DISCOVERY_LINK_HEADER = getDiscoveryLinkHeader();
export const HOMEPAGE_MARKDOWN = getHomepageMarkdown();

export async function onRequest(context) {
  const markdownResponse = handleMarkdownRequest(context.request, context.env);
  if (markdownResponse) {
    return markdownResponse;
  }

  const response = await context.next();
  if (!isHomepageRequest(context.request)) {
    return response;
  }

  return withHomepageDiscoveryHeaders(
    response,
    resolveRequestSiteConfig(context.request, context.env),
  );
}

export function handleMarkdownRequest(request, env = {}) {
  if (!isHomepageRequest(request) || !["GET", "HEAD"].includes(request.method) || !acceptsMarkdown(request)) {
    return null;
  }

  return createHomepageMarkdownResponse(
    request.method,
    resolveRequestSiteConfig(request, env),
  );
}

export function createHomepageMarkdownResponse(method = "GET", env = {}) {
  const markdown = getHomepageMarkdown(env);
  return new Response(method === "HEAD" ? null : markdown, {
    headers: buildHomepageHeaders({
      "cache-control": "public, max-age=3600",
      "content-type": "text/markdown; charset=UTF-8",
      "x-markdown-tokens": String(countApproximateTokens(markdown)),
    }, env),
  });
}

function getDiscoveryLinkHeader(env = {}) {
  const { siteOrigin } = resolveWebUiSiteConfig(env);
  return [
    `<${siteOrigin}/sitemap.xml>; rel="sitemap"; type="application/xml"`,
    `<${siteOrigin}/index.md>; rel="alternate"; type="text/markdown"`,
    `<${siteOrigin}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
  ].join(", ");
}

function getHomepageMarkdown(env = {}) {
  const {
    siteOrigin,
    siteUrl,
    socialPreviewUrl,
    sourceRepositoryUrl,
  } = resolveWebUiSiteConfig(env);

  return `---
title: ${WEBUI_SITE_NAME}
description: ${WEBUI_SITE_DESCRIPTION}
image: ${socialPreviewUrl}
---

# ${WEBUI_SITE_NAME}

${WEBUI_SITE_NAME} is the official browser-first LibChecker package analyzer for APK, APKS, APKM, XAPK, and LCAPPS files.

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

- Web UI: ${siteUrl}
- Sitemap: ${siteOrigin}/sitemap.xml
- Source repository: ${sourceRepositoryUrl}
`;
}

function withHomepageDiscoveryHeaders(response, env = {}) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildHomepageHeaders(response.headers, env),
  });
}

function buildHomepageHeaders(sourceHeaders, env = {}) {
  const headers = new Headers(sourceHeaders);
  headers.set("Link", getDiscoveryLinkHeader(env));
  headers.set("Content-Signal", "search=yes,ai-input=yes,ai-train=no,use=reference");
  headers.set("Vary", mergeVary(headers.get("Vary"), "Accept"));
  return headers;
}

function resolveRequestSiteConfig(request, env = {}) {
  const siteOrigin = normalizeRequestSiteOrigin(env.WEBUI_SITE_ORIGIN)
    || normalizeRequestSiteOrigin(env.WEBUI_SITE_URL)
    || new URL(request.url).origin;
  return {
    ...env,
    WEBUI_SITE_ORIGIN: siteOrigin,
  };
}

function normalizeRequestSiteOrigin(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  try {
    return new URL(text).origin;
  } catch {
    return "";
  }
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
