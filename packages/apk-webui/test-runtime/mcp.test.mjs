import { createPagesEventContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequest } from "../functions/mcp.js";

function request(method, params = {}, version = "2026-07-28") {
  return new Request("https://webui.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "Mcp-Method": method, ...(params.name ? { "Mcp-Name": params.name } : {}), "MCP-Protocol-Version": version },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {
      ...params, _meta: {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "runtime-test", version: "1" },
      },
    } }),
  });
}
const handle = (req) => onRequest(createPagesEventContext({ request: req }));

describe("MCP Pages runtime", () => {
  it("serves modern discovery/tools using the Workers SDK path", async () => {
    const discovery = await handle(request("server/discover"));
    expect(discovery.status).toBe(200);
    expect((await discovery.json()).result).toBeDefined();
    const response = await handle(request("tools/list"));
    expect((await response.json()).result.tools[0].name).toBe("analyze_apk_url");
  });
  it("returns tool errors for private URLs", async () => {
    const response = await handle(request("tools/call", { name: "analyze_apk_url", arguments: { url: "http://127.0.0.1/app.apk" } }));
    expect((await response.json()).result.isError).toBe(true);
  });
  it("rejects oversized bodies, invalid versions, and foreign origins", async () => {
    const oversized = request("tools/list", { padding: "x".repeat(17000) });
    expect((await handle(oversized)).status).toBe(413);
    const foreign = request("tools/list");
    foreign.headers.set("origin", "https://evil.example");
    expect((await handle(foreign)).status).toBe(403);
    const invalidVersion = await handle(request("tools/list", {}, "2099-01-01"));
    expect((await invalidVersion.json()).error).toBeDefined();
    const malformed = new Request("https://webui.example/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{" });
    expect((await handle(malformed)).status).toBe(400);
  });
});
