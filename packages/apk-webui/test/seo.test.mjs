import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMarkdownRequest,
  onRequest,
} from "../functions/_middleware.js";
import {
  WEBUI_SITE_DESCRIPTION,
  WEBUI_SITE_NAME,
  WEBUI_SITE_TITLE,
} from "../site-config.mjs";

test("SEO metadata keeps the LibChecker brand and package analyzer purpose explicit", () => {
  assert.match(WEBUI_SITE_NAME, /^LibChecker\b/u);
  assert.match(WEBUI_SITE_TITLE, /^LibChecker WebUI\b/u);
  assert.match(WEBUI_SITE_TITLE, /APK Analyzer/u);
  assert.match(WEBUI_SITE_DESCRIPTION, /^Official LibChecker WebUI\b/u);
  assert.match(WEBUI_SITE_DESCRIPTION, /locally in your browser/u);
});

test("homepage discovery headers use the request origin when runtime site variables are absent", async () => {
  const request = new Request("https://lc.absinthe.life/");
  const response = await onRequest({
    request,
    env: {},
    next: async () => new Response("homepage"),
  });

  const link = response.headers.get("Link") || "";
  assert.match(link, /<https:\/\/lc\.absinthe\.life\/sitemap\.xml>/u);
  assert.match(link, /<https:\/\/lc\.absinthe\.life\/index\.md>/u);
  assert.doesNotMatch(link, /example\.com/u);
});

test("runtime site variables take priority over the request origin", async () => {
  const request = new Request("https://preview.pages.dev/");
  const response = await onRequest({
    request,
    env: { WEBUI_SITE_URL: "https://lc.absinthe.life/" },
    next: async () => new Response("homepage"),
  });

  const link = response.headers.get("Link") || "";
  assert.match(link, /<https:\/\/lc\.absinthe\.life\/sitemap\.xml>/u);
  assert.doesNotMatch(link, /preview\.pages\.dev/u);
});

test("Markdown representation uses the request origin and richer product description", async () => {
  const request = new Request("https://lc.absinthe.life/", {
    headers: { Accept: "text/markdown" },
  });
  const response = handleMarkdownRequest(request);

  assert.ok(response);
  const markdown = await response.text();
  assert.match(markdown, /official browser-first LibChecker package analyzer/u);
  assert.match(markdown, /Web UI: https:\/\/lc\.absinthe\.life\//u);
  assert.doesNotMatch(markdown, /https:\/\/example\.com/u);
});
