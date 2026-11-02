import assert from "node:assert/strict";
import test from "node:test";
import { createMcpReport } from "../src/mcp-report.js";

test("MCP reports page details, disclose coverage, and remove binary/URL content", () => {
  const report = { sourceUrl: "https://private.example/token", fileName: "test.apk", apkInfo: {
    packageName: "example.test", icon: "data:image/png;base64,secret",
    permissions: Array.from({ length: 120 }, (_, i) => `permission.${i}`),
    components: { activities: Array.from({ length: 80 }, (_, i) => ({ name: `Activity${i}` })) },
    sdkSummary: { native: [{ name: "SDK", icon: "data:image/svg+xml,secret" }] },
    nativeLibraries: [{ abi: "arm64-v8a" }], archive: { analyzedEntry: "base.apk" },
  } };
  const result = createMcpReport(report, { sections: ["permissions", "components"], offset: 50, limit: 2 });
  const data = result.structuredContent;
  assert.equal(data.mode, "remote-preview");
  assert.deepEqual(data.details.permissions, { total: 120, offset: 50, items: ["permission.50", "permission.51"] });
  assert.equal(data.details.components.activities.items[0].name, "Activity50");
  assert.equal(data.limitations.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /secret|private\.example|data:image/);
  assert.deepEqual(data.abis, ["arm64-v8a"]);
});

test("MCP reports disclose truncated metadata and enforce total response budget", () => {
  const result = createMcpReport({ apkInfo: { appName: "x".repeat(3000) } });
  assert.ok(result.structuredContent.truncatedFields.includes(".package.appName"));
  const huge = createMcpReport({ apkInfo: { permissions: Array(50).fill("x".repeat(2048)) } }, { sections: ["permissions"] });
  assert.equal(huge.isError, true);
});
