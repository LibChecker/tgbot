import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, open, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createSmokeApk, createStoredZip } from "../../apk-webui/test-browser/fixtures.mjs";
import { readAndroidPackageInfo } from "../../shared/src/apk.js";
import { analyzeFile } from "../src/analyze.mjs";

for (const mode of ["legacy", { pin: "2026-07-28" }]) {
  test(`stdio MCP discovers and analyzes files (${JSON.stringify(mode)})`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "apk-mcp-"));
    const path = join(directory, "fixture.apk");
    const apk = createSmokeApk();
    await writeFile(path, apk);
    const client = new Client({ name: "acceptance", version: "1" }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../src/server.mjs", import.meta.url))], stderr: "pipe" });
    let stderr = "";
    try {
      await client.connect(transport);
      transport.stderr?.on("data", (data) => { stderr += data; });
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["analyze_apk_file"]);
      const result = await client.callTool({ name: "analyze_apk_file", arguments: { path, sections: ["nativeLibraries"] } });
      assert.ok(!result.isError, JSON.stringify(result));
      assert.equal(result.structuredContent.package.packageName, (await readAndroidPackageInfo(apk)).packageName);
      assert.deepEqual(result.structuredContent.abis, ["arm64-v8a"]);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(directory));
      const container = join(directory, "fixture.apks");
      await writeFile(container, createStoredZip([["base.apk", apk]]));
      assert.ok(!(await client.callTool({ name: "analyze_apk_file", arguments: { path: container } })).isError);
      const missing = await client.callTool({ name: "analyze_apk_file", arguments: { path: join(directory, "missing.apk") } });
      assert.equal(missing.isError, true);
      assert.doesNotMatch(JSON.stringify(missing), /missing\.apk/);
      const oversized = await open(path, "w");
      await oversized.truncate(512 * 1024 * 1024 + 1);
      await oversized.close();
      assert.equal((await client.callTool({ name: "analyze_apk_file", arguments: { path } })).isError, true);
      const directoryApk = join(directory, "directory.apk");
      await mkdir(directoryApk);
      assert.equal((await client.callTool({ name: "analyze_apk_file", arguments: { path: directoryApk } })).isError, true);
      await writeFile(path, "broken package");
      assert.equal((await client.callTool({ name: "analyze_apk_file", arguments: { path } })).isError, true);
      assert.equal((await client.callTool({ name: "analyze_apk_file", arguments: { path: "relative.apk" } })).isError, true);
      assert.equal(stderr, "");
    } finally {
      await client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("local analysis aborts without leaving the worker or busy flag behind", async () => {
  const controller = new AbortController();
  const pending = analyzeFile({ path: "/nonexistent.apk" }, controller.signal);
  await assert.rejects(analyzeFile({ path: "/another.apk" }), /Another APK analysis/);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(analyzeFile({ path: "/nonexistent.apk" }), /Cannot read/);
});
