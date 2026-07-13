import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AGENT_SKILLS_SCHEMA,
  ANALYZE_ANDROID_PACKAGE_SKILL,
  createAgentSkillsIndex,
  createApiCatalog,
  createAuthMarkdown,
  createOpenApiDocument,
  sha256Digest,
} from "../discovery.mjs";

const siteOrigin = "https://webui.example";

test("API catalog links the public API to its spec, docs, and health endpoint", () => {
  const catalog = createApiCatalog(siteOrigin);
  assert.equal(catalog.linkset.length, 1);
  assert.deepEqual(catalog.linkset[0], {
    anchor: `${siteOrigin}/url-report`,
    "service-desc": [{
      href: `${siteOrigin}/openapi.json`,
      type: "application/vnd.oai.openapi+json;version=3.1",
    }],
    "service-doc": [{
      href: `${siteOrigin}/api-docs.md`,
      type: "text/markdown",
    }],
    status: [{
      href: `${siteOrigin}/health`,
      type: "application/json",
    }],
  });
});

test("OpenAPI documents only the real public URL analysis and health endpoints", () => {
  const openapi = createOpenApiDocument(siteOrigin);
  assert.equal(openapi.openapi, "3.1.0");
  assert.equal(openapi.servers[0].url, siteOrigin);
  assert.deepEqual(Object.keys(openapi.paths), ["/url-report", "/health"]);
  assert.deepEqual(
    openapi.paths["/url-report"].post.requestBody.content["application/json"].schema.required,
    ["url"],
  );
});

test("Agent Skills index contains a verifiable SHA-256 digest", async () => {
  const skillBytes = await readFile(new URL(
    `../agent-skills/${ANALYZE_ANDROID_PACKAGE_SKILL.name}/SKILL.md`,
    import.meta.url,
  ));
  const index = createAgentSkillsIndex(skillBytes);
  assert.equal(index.$schema, AGENT_SKILLS_SCHEMA);
  assert.equal(index.skills.length, 1);
  assert.equal(index.skills[0].digest, sha256Digest(skillBytes));
  assert.match(index.skills[0].digest, /^sha256:[a-f0-9]{64}$/u);
});

test("auth.md truthfully documents the unauthenticated public API", () => {
  const markdown = createAuthMarkdown(siteOrigin);
  assert.match(markdown, /^# .*auth\.md/mu);
  assert.match(markdown, /No agent registration, OAuth flow, API key, or bearer token is required/u);
  assert.match(markdown, /does not operate an OAuth authorization server or an MCP server/u);
});
