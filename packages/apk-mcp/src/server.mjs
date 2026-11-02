import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { analyzeFile } from "./analyze.mjs";
import { MCP_REPORT_SECTIONS } from "../../shared/src/mcp-report.js";

serveStdio(() => {
  const server = new McpServer({ name: "libchecker-local", version: "1.0.0" });
  server.registerTool("analyze_apk_file", {
    description: "Analyze an explicitly selected local APK/APKS/APKM/XAPK without uploading it. Returns bounded static metadata; not a malware verdict. Files up to 512 MiB; 60-second time limit.",
    inputSchema: z.object({
      path: z.string().min(1).max(4096),
      sections: z.array(z.enum(MCP_REPORT_SECTIONS)).max(6).optional(),
      offset: z.number().int().min(0).max(100000).default(0),
      limit: z.number().int().min(1).max(50).default(50),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (args, ctx) => {
    try { return await analyzeFile(args, ctx.mcpReq.signal); }
    catch (error) { return { isError: true, content: [{ type: "text", text: error.message }] }; }
  });
  return server;
}, {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 16 * 1024 }),
  onerror: () => console.error("MCP protocol error"),
});
