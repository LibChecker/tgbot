import { createHash } from "node:crypto";

export const API_CATALOG_MEDIA_TYPE = "application/linkset+json";
export const API_CATALOG_PROFILE = "https://www.rfc-editor.org/info/rfc9727";
export const AGENT_SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
export const ANALYZE_ANDROID_PACKAGE_SKILL = Object.freeze({
  name: "analyze-android-package",
  type: "skill-md",
  description: "Analyze a public APK/APKS/APKM/XAPK download URL with LibChecker WebUI and interpret the returned package report.",
  url: "/.well-known/agent-skills/analyze-android-package/SKILL.md",
});

export function createApiCatalog(siteOrigin) {
  return {
    linkset: [
      {
        anchor: `${siteOrigin}/url-report`,
        "service-desc": [
          {
            href: `${siteOrigin}/openapi.json`,
            type: "application/vnd.oai.openapi+json;version=3.1",
          },
        ],
        "service-doc": [
          {
            href: `${siteOrigin}/api-docs.md`,
            type: "text/markdown",
          },
        ],
        status: [
          {
            href: `${siteOrigin}/health`,
            type: "application/json",
          },
        ],
      },
    ],
  };
}

export function createOpenApiDocument(siteOrigin) {
  return {
    openapi: "3.1.0",
    info: {
      title: "LibChecker WebUI URL Analysis API",
      version: "1.0.0",
      description: "Analyze a public Android package download URL using remote range requests. Local file analysis remains browser-only.",
    },
    servers: [
      {
        url: siteOrigin,
      },
    ],
    paths: {
      "/url-report": {
        post: {
          operationId: "analyzeAndroidPackageUrl",
          summary: "Analyze a public Android package URL",
          description: "Accepts APK, APKS, APKM, or XAPK URLs that the service can inspect with bounded remote range requests.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["url"],
                  properties: {
                    url: {
                      type: "string",
                      format: "uri",
                      pattern: "^https?://",
                    },
                    locale: {
                      type: "string",
                      enum: ["en", "zh-Hans"],
                      default: "en",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Analysis result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["report"],
                    properties: {
                      report: {
                        type: "object",
                        description: "LibChecker APK report",
                      },
                      source: {
                        type: "object",
                      },
                    },
                  },
                },
                "application/x-ndjson": {
                  schema: {
                    type: "string",
                    description: "Progress events followed by a final result event",
                  },
                },
              },
            },
            400: {
              description: "Invalid request or URL",
            },
            405: {
              description: "Method not allowed",
            },
            422: {
              description: "The remote package could not be analyzed",
            },
          },
        },
      },
      "/health": {
        get: {
          operationId: "getServiceHealth",
          summary: "Check discovery and API availability",
          responses: {
            200: {
              description: "Service is available",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status", "service"],
                    properties: {
                      status: {
                        type: "string",
                        const: "ok",
                      },
                      service: {
                        type: "string",
                        const: "libchecker-webui",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function createApiDocsMarkdown(siteOrigin) {
  return `# LibChecker WebUI API

LibChecker WebUI exposes one unauthenticated public API for analyzing a public Android package download URL.

## Analyze a URL

Send a \`POST\` request to \`${siteOrigin}/url-report\` with JSON:

\`\`\`json
{
  "url": "https://example.com/app.apk",
  "locale": "en"
}
\`\`\`

Use \`Accept: application/json\` for a single response or \`Accept: application/x-ndjson\` for progress events followed by the result. The response contains a LibChecker package report when analysis succeeds.

The endpoint only accepts public HTTP or HTTPS download URLs. Do not send credentials, private URLs, or private package data. For complete local analysis, open the Web UI and select a file in the browser.

## Discovery

- OpenAPI: ${siteOrigin}/openapi.json
- API Catalog: ${siteOrigin}/.well-known/api-catalog
- Health: ${siteOrigin}/health
- Authentication guidance: ${siteOrigin}/auth.md
`;
}

export function createAuthMarkdown(siteOrigin) {
  return `# LibChecker WebUI auth.md

## Agent audience

Agents may use the public URL analysis API to inspect Android packages that are already available from a public HTTP or HTTPS download URL.

## Registration and credentials

No agent registration, OAuth flow, API key, or bearer token is required for \`POST ${siteOrigin}/url-report\`. Do not attach credentials to requests and do not submit private package URLs or private package data.

LibChecker WebUI does not operate an OAuth authorization server or an MCP server. Separate Telegram bot administration endpoints are private operator surfaces and are intentionally excluded from public discovery metadata.

## API documentation

- OpenAPI: ${siteOrigin}/openapi.json
- Human-readable documentation: ${siteOrigin}/api-docs.md
- API Catalog: ${siteOrigin}/.well-known/api-catalog
`;
}

export function createAgentSkillsIndex(skillBytes) {
  return {
    $schema: AGENT_SKILLS_SCHEMA,
    skills: [
      {
        ...ANALYZE_ANDROID_PACKAGE_SKILL,
        digest: sha256Digest(skillBytes),
      },
    ],
  };
}

export function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
