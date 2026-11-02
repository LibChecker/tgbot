import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { onRequest } from "../functions/mcp.js";
import { createSmokeApk, createStoredZip } from "../test-browser/fixtures.mjs";

const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
};
function request(method, params = {}, modern = true) {
  return new Request("https://webui.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "Mcp-Method": method, ...(params.name ? { "Mcp-Name": params.name } : {}), ...(modern ? { "MCP-Protocol-Version": "2026-07-28" } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: modern ? { ...params, _meta: meta } : params }),
  });
}
async function rpc(method, params = {}, modern = true) {
  const response = await onRequest({ request: request(method, params, modern), env: {} });
  const text = await response.text();
  const data = text.startsWith("event:") ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text;
  return { response, data: JSON.parse(data) };
}

test("HTTP MCP serves modern discovery and legacy initialization", async () => {
  const discovered = await rpc("server/discover");
  assert.equal(discovered.response.status, 200);
  assert.ok(discovered.data.result);
  const tools = await rpc("tools/list");
  assert.equal(tools.data.result.tools[0].name, "analyze_apk_url");
  assert.equal(tools.response.headers.get("cache-control"), "no-store");
  const legacy = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy", version: "1" } }, false);
  assert.equal(legacy.data.result.protocolVersion, "2025-11-25");
  assert.equal((await rpc("tools/list", {}, false)).data.result.tools[0].name, "analyze_apk_url");
});

test("HTTP MCP returns a real range-parsed APK and rejects unsafe redirects/large responses", async (t) => {
  t.mock.method(console, "log", () => {});
  const apk = createSmokeApk();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, "manual");
    const [, start, end] = options.headers.range.match(/bytes=(\d+)-(\d+)/);
    const bytes = apk.subarray(Number(start), Math.min(Number(end) + 1, apk.length));
    return new Response(bytes, { status: 206, headers: { "content-range": `bytes ${start}-${Number(start) + bytes.length - 1}/${apk.length}`, "content-length": String(bytes.length), "content-type": "application/vnd.android.package-archive" } });
  });
  const success = await rpc("tools/call", { name: "analyze_apk_url", arguments: { url: "https://download.example/app.apk" } });
  assert.ok(!success.data.result.isError, JSON.stringify(success.data));
  assert.equal(success.data.result.structuredContent.mode, "remote-preview");
  assert.equal(success.data.result.structuredContent.package.packageName, "com.example.smoke");
  assert.ok(calls.length > 0);
  const beforeRedirect = globalThis.fetch.mock.callCount();
  globalThis.fetch.mock.mockImplementation(async (url) => {
    assert.equal(new URL(url).hostname, "download.example");
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private.apk" } });
  });
  assert.equal((await rpc("tools/call", { name: "analyze_apk_url", arguments: { url: "https://download.example/redirect.apk" } })).data.result.isError, true);
  assert.equal(globalThis.fetch.mock.callCount(), beforeRedirect + 1);
  globalThis.fetch.mock.mockImplementation(async () => new Response(new Uint8Array(1025), { status: 206 }));
  assert.equal((await rpc("tools/call", { name: "analyze_apk_url", arguments: { url: "https://download.example/large.apk" } })).data.result.isError, true);
});

test("HTTP MCP rejects invalid tool arguments without outbound I/O", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network access"); });
  for (const url of ["file:///tmp/a.apk", "http://localhost/a.apk", "https://user:pass@example.com/a.apk"]) {
    assert.equal((await rpc("tools/call", { name: "analyze_apk_url", arguments: { url } })).data.result.isError, true);
  }
  const invalid = await rpc("tools/call", { name: "analyze_apk_url", arguments: { url: "https://example.com/a.apk", limit: 1000 } });
  assert.ok(invalid.data.error || invalid.data.result?.isError);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});


test("remote preview bounds decompressed manifests using declared and absolute limits", async (t) => {
  t.mock.method(console, "log", () => {});
  const original = createSmokeApk();
  const dataOffset = 30 + original.readUInt16LE(26) + original.readUInt16LE(28);
  const manifest = original.subarray(dataOffset, dataOffset + original.readUInt32LE(18));
  let apk;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const [, start, end] = options.headers.range.match(/bytes=(\d+)-(\d+)/);
    const bytes = apk.subarray(Number(start), Number(end) + 1);
    return new Response(bytes, { status: 206, headers: {
      "content-range": `bytes ${start}-${Number(start) + bytes.length - 1}/${apk.length}`,
    } });
  });
  for (const declaredSize of [manifest.length, 1, 25 * 1024 * 1024]) {
    apk = Buffer.from(createStoredZip([["AndroidManifest.xml", deflateRawSync(manifest)]]));
    const central = apk.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    apk.writeUInt16LE(8, 8);
    apk.writeUInt16LE(8, central + 10);
    apk.writeUInt32LE(declaredSize, central + 24);
    const { data } = await rpc("tools/call", { name: "analyze_apk_url", arguments: { url: "https://download.example/compressed.apk" } });
    assert.equal(Boolean(data.result.isError), declaredSize !== manifest.length);
  }
});
