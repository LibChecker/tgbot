import { env } from "cloudflare:workers";
import { createPagesEventContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { onRequest as handleAnalytics } from "../functions/analytics.js";
import { onRequest as handleHealth } from "../functions/health.js";
import { onRequest as handleUrlReport } from "../functions/url-report.js";

describe("Pages Functions runtime", () => {
  it("loads configured bindings and serves the health contract", async () => {
    expect(env.WEBUI_ANALYTICS).toBeDefined();

    const getResponse = await handleHealth(createContext(new Request("https://webui.example.com/health")));
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      service: "libchecker-webui",
      status: "ok",
    });

    const headResponse = await handleHealth(createContext(new Request("https://webui.example.com/health", {
      method: "HEAD",
    })));
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");

    const rejected = await handleHealth(createContext(new Request("https://webui.example.com/health", {
      method: "POST",
    })));
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get("allow")).toBe("GET, HEAD");
  });

  it("handles analytics preflight and rejects UTF-8 bodies over 8 KiB", async () => {
    const preflight = await handleAnalytics(createContext(new Request("https://webui.example.com/analytics", {
      method: "OPTIONS",
    })));
    expect(preflight.status).toBe(204);

    const valid = await handleAnalytics(createContext(new Request("https://webui.example.com/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "webui.runtime.tested", result: "success" }),
    })));
    expect(valid.status).toBe(204);

    const oversized = await handleAnalytics(createContext(new Request("https://webui.example.com/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "webui.runtime.tested", value: "测".repeat(3000) }),
    })));
    expect(oversized.status).toBe(413);
  });

  it("returns 413 for an oversized URL report body and 400 for invalid URLs", async () => {
    const oversized = await handleUrlReport(createContext(new Request("https://webui.example.com/url-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/app.apk", padding: "测".repeat(3000) }),
    })));
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).error.code).toBe("request_body_too_large");

    const invalid = await handleUrlReport(createContext(new Request("https://webui.example.com/url-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "file:///tmp/app.apk" }),
    })));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("invalid_download_url");
  });
});

function createContext(request) {
  return createPagesEventContext({ request });
}
