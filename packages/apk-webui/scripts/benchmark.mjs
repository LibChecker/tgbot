import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { env } from "node:process";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { parseArgs as parseCliArgs } from "node:util";
import { chromium } from "@playwright/test";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(projectDir, "../..");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
]);

const options = parseArgs(process.argv.slice(2));
const distDir = resolve(projectDir, options.dist || "dist");
const label = options.label || "current";
const samplePaths = options.samples;
const remoteUrl = options.url ? new URL(options.url).href : "";
const existingSamples = [];
for (const samplePath of samplePaths) {
  try {
    const sampleStat = await stat(samplePath);
    if (sampleStat.isFile()) {
      existingSamples.push(resolve(samplePath));
    }
  } catch {
    // Missing optional local samples are reported in the output metadata.
  }
}

const outputPath = options.output
  ? resolve(repoDir, options.output)
  : resolve(tmpdir(), `tgbot-webui-benchmark-${label}-${Date.now()}.json`);

const distStats = await collectDistStats(distDir);
const server = remoteUrl ? null : await createStaticServer(distDir);
const browser = await launchBrowser();

try {
  const pageUrl = remoteUrl || `http://127.0.0.1:${server.port}/`;
  const firstScreen = await measureFirstScreen(browser, pageUrl);
  const samples = [];

  for (const samplePath of existingSamples) {
    samples.push(await measureSample(browser, pageUrl, samplePath));
  }

  const result = {
    label,
    measuredAt: new Date().toISOString(),
    distDir: relative(repoDir, distDir),
    outputPath: relative(repoDir, outputPath),
    pageUrl,
    sampleInputs: samplePaths.map((samplePath) => ({
      name: basename(samplePath),
      path: samplePath,
      available: existingSamples.includes(resolve(samplePath)),
    })),
    dist: distStats,
    firstScreen,
    samples,
  };

  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  printSummary(result, outputPath);
} finally {
  await browser.close().catch(() => {});
  if (server) {
    await server.close();
  }
}

function parseArgs(args) {
  const { values } = parseCliArgs({
    args,
    options: {
      dist: { type: "string" },
      label: { type: "string" },
      output: { type: "string" },
      sample: { type: "string", multiple: true },
      url: { type: "string" },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  return {
    dist: values.dist || "",
    label: values.label || "",
    output: values.output || "",
    samples: (values.sample || []).filter(Boolean),
    url: values.url || "",
  };
}

function printHelp() {
  console.log([
    "Usage: node scripts/benchmark.mjs [options]",
    "",
    "Options:",
    "  --label <name>      Label used in the result JSON",
    "  --dist <path>       Dist directory relative to packages/apk-webui",
    "  --output <path>     Output JSON path relative to the repository root",
    "  --sample <path>     APK/APKS sample path; may be repeated",
    "  --url <url>         Measure an already deployed WebUI URL instead of local dist",
    "",
    "When no --sample is provided, only page-load metrics are captured.",
  ].join("\n"));
}

async function collectDistStats(rootDir) {
  const files = await collectFiles(rootDir);
  const assets = [];
  let totalBytes = 0;
  let jsBytes = 0;
  let jsGzipBytes = 0;

  for (const file of files) {
    const buffer = await readFile(file);
    const extension = extname(file);
    const bytes = buffer.byteLength;
    const relativePath = normalizePath(relative(rootDir, file));
    totalBytes += bytes;

    const asset = {
      path: relativePath,
      bytes,
      gzipBytes: gzipSync(buffer).byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex").slice(0, 12),
    };
    assets.push(asset);

    if (extension === ".js") {
      jsBytes += bytes;
      jsGzipBytes += asset.gzipBytes;
    }
  }

  assets.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

  return {
    fileCount: files.length,
    totalBytes,
    jsFileCount: assets.filter((asset) => asset.path.endsWith(".js")).length,
    jsBytes,
    jsGzipBytes,
    largestAssets: assets.slice(0, 20),
  };
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function createStaticServer(rootDir) {
  const server = createServer(async (request, response) => {
    if (request.url === "/analytics" && request.method === "POST") {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end();
      return;
    }

    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const target = resolve(rootDir, `.${pathname === "/" ? "/index.html" : pathname}`);

    if (!isInside(rootDir, target)) {
      response.writeHead(403);
      response.end();
      return;
    }

    let filePath = target;
    let fileStat = null;
    try {
      fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = resolve(filePath, "index.html");
        fileStat = await stat(filePath);
      }
    } catch {
      filePath = resolve(rootDir, "index.html");
      fileStat = await stat(filePath);
    }

    response.writeHead(200, {
      "cache-control": filePath.includes(`${sep}assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "content-length": fileStat.size,
      "content-type": contentTypes.get(extname(filePath)) || "application/octet-stream",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolveServer, rejectServer) => {
    server.on("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      resolveServer({
        port: server.address().port,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function isInside(rootDir, target) {
  const relativePath = relative(rootDir, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function launchBrowser() {
  const chromePath = await findChrome();
  return chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-popup-blocking",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
}

async function findChrome() {
  const candidates = getChromeCandidates();

  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next browser.
    }
  }

  throw new Error("Could not find a Chrome-compatible browser");
}

function getChromeCandidates() {
  if (process.platform === "win32") {
    return [
      resolveBrowserCandidate(env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
      resolveBrowserCandidate(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
      resolveBrowserCandidate(env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
      resolveBrowserCandidate(env.PROGRAMFILES || "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe"),
      resolveBrowserCandidate(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
      resolveBrowserCandidate(env.LOCALAPPDATA, "Microsoft/Edge/Application/msedge.exe"),
    ].filter(Boolean);
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

function resolveBrowserCandidate(baseDir, browserPath) {
  return baseDir ? resolve(baseDir, browserPath) : "";
}

async function createPage(browser, url) {
  const context = await browser.newContext({ viewport: null });
  await context.addInitScript(createBenchmarkInjectionScript());
  const playwrightPage = await context.newPage();
  const events = createEventCollector(playwrightPage);
  await playwrightPage.goto(url, { waitUntil: "load", timeout: 30_000 });

  return {
    page: playwrightPage,
    events,
    evaluate: (expression) => playwrightPage.evaluate(expression),
    close: () => playwrightPage.close(),
    dispose: () => context.close(),
  };
}

function createEventCollector(page) {
  const network = new Map();
  const pending = new Set();
  let nextRequestId = 0;

  page.on("request", (request) => {
    nextRequestId += 1;
    network.set(request, {
      requestId: String(nextRequestId),
      url: request.url(),
      type: mapResourceType(request.resourceType()),
      method: request.method(),
      startTime: Date.now() / 1000,
      status: 0,
      mimeType: "",
      encodedDataLength: 0,
      fromDiskCache: false,
      fromMemoryCache: false,
      headers: {},
    });
  });

  page.on("response", (response) => schedule(async () => {
    const entry = network.get(response.request());
    if (!entry) {
      return;
    }
    entry.status = response.status();
    entry.headers = await response.allHeaders();
    entry.mimeType = String(entry.headers["content-type"] || "").split(";", 1)[0];
  }));

  page.on("requestfinished", (request) => schedule(async () => {
    const entry = network.get(request);
    if (!entry) {
      return;
    }
    const sizes = await request.sizes();
    entry.encodedDataLength = sizes.responseHeadersSize + sizes.responseBodySize;
    entry.endTime = Date.now() / 1000;
  }));

  return {
    requests: network,
    async settle() {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };

  function schedule(work) {
    const pendingWork = Promise.resolve().then(work).catch(() => {});
    pending.add(pendingWork);
    void pendingWork.finally(() => pending.delete(pendingWork));
  }
}

function mapResourceType(type) {
  const types = {
    document: "Document",
    stylesheet: "Stylesheet",
    image: "Image",
    media: "Media",
    font: "Font",
    script: "Script",
    texttrack: "TextTrack",
    xhr: "XHR",
    fetch: "Fetch",
    eventsource: "EventSource",
    ping: "Ping",
    websocket: "WebSocket",
    manifest: "Manifest",
    other: "Other",
  };
  return types[type] || "Other";
}

async function measureFirstScreen(browser, pageUrl) {
  const page = await createPage(browser, pageUrl);
  await delay(2500);
  const metrics = await page.evaluate("window.__webuiBenchmarkSnapshot()");
  await page.events.settle();
  const requests = summarizeRequests(page.events.requests, pageUrl);
  await page.close();
  await page.dispose();
  return {
    metrics,
    requests,
  };
}

async function measureSample(browser, pageUrl, samplePath) {
  const page = await createPage(browser, pageUrl);
  await delay(500);
  await page.page.locator("#file-input").setInputFiles(samplePath);
  const startedAt = Date.now();
  await page.page.locator("#analyze-form").evaluate((form) => form.requestSubmit());

  const flow = await waitForAnalysis(page, 180_000);
  const wallTimeMs = Date.now() - startedAt;
  await delay(50);
  // The legacy page CDP session excluded the dedicated Worker's module graph.
  // Keep request metrics scoped to page Resource Timing entries for compatible JSON.
  const pageResourceUrls = await page.evaluate(
    "performance.getEntriesByType('resource').map((entry) => entry.name)",
  );
  await page.events.settle();
  const requests = summarizeRequests(page.events.requests, pageUrl, {
    allowedRequestUrls: pageResourceUrls,
    zeroTransferUrls: [flow.worker?.url].filter(Boolean),
  });
  await page.close();
  await page.dispose();

  return {
    name: basename(samplePath),
    path: samplePath,
    fileBytes: (await stat(samplePath)).size,
    wallTimeMs,
    flow,
    requests,
  };
}

async function waitForAnalysis(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await page.evaluate(`(() => {
      const snapshot = window.__webuiBenchmarkSnapshot();
      const latestWorker = snapshot.workers[snapshot.workers.length - 1] || null;
      const error = document.querySelector('#error-box:not([hidden])')?.textContent || '';
      const resultVisible = !document.querySelector('#result-view')?.hidden;
      const observedAt = performance.now();
      const done = Boolean(error || (latestWorker?.resultAt && resultVisible));
      return {
        done,
        error,
        progressText: document.querySelector('#progress-label')?.textContent || '',
        resultVisible,
        reportTitle: document.querySelector('#report-hero h2, #report-hero h1')?.textContent || '',
        worker: latestWorker,
        workerResultToVisibleMs: latestWorker?.resultAt && resultVisible
          ? observedAt - latestWorker.resultAt
          : 0,
      };
    })()`);
    if (value.done) {
      return value;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for APK analysis");
}

function createBenchmarkInjectionScript() {
  return String.raw`
    (() => {
      const bench = {
        workers: [],
        longTasks: [],
        lcp: [],
        layoutShifts: [],
      };
      window.__webuiBenchmark = bench;

      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            bench.longTasks.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {}

      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            bench.lcp.push({
              startTime: entry.startTime,
              renderTime: entry.renderTime,
              loadTime: entry.loadTime,
              size: entry.size,
              url: entry.url || "",
              element: entry.element?.tagName || "",
            });
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {}

      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.hadRecentInput) {
              continue;
            }
            bench.layoutShifts.push({
              startTime: entry.startTime,
              value: entry.value,
            });
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch {}

      const NativeWorker = window.Worker;
      window.Worker = function benchmarkWorker(url, options) {
        const record = {
          id: bench.workers.length + 1,
          url: String(url),
          createdAt: performance.now(),
          postedAt: 0,
          firstProgressAt: 0,
          resultAt: 0,
          errorAt: 0,
          resultDurationMs: 0,
          messages: [],
        };
        bench.workers.push(record);
        const worker = new NativeWorker(url, options);
        const postMessage = worker.postMessage.bind(worker);
        worker.postMessage = (message, ...rest) => {
          if (message && message.type === "analyze" && !record.postedAt) {
            record.postedAt = performance.now();
          }
          return postMessage(message, ...rest);
        };
        worker.addEventListener("message", (event) => {
          const data = event.data || {};
          const at = performance.now();
          record.messages.push({
            type: data.type || "",
            stage: data.stage || "",
            at,
            durationMs: data.report?.durationMs || 0,
          });
          if (data.type === "progress" && !record.firstProgressAt) {
            record.firstProgressAt = at;
          } else if (data.type === "result") {
            record.resultAt = at;
            record.resultDurationMs = data.report?.durationMs || 0;
          } else if (data.type === "error") {
            record.errorAt = at;
          }
        });
        worker.addEventListener("error", () => {
          record.errorAt = performance.now();
        });
        return worker;
      };
      window.Worker.prototype = NativeWorker.prototype;
      Object.setPrototypeOf(window.Worker, NativeWorker);

      window.__webuiBenchmarkSnapshot = () => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const paints = Object.fromEntries(
          performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime])
        );
        const resources = performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize,
          nextHopProtocol: entry.nextHopProtocol,
          renderBlockingStatus: entry.renderBlockingStatus,
        }));
        return {
          timeOrigin: performance.timeOrigin,
          navigation: navigation ? navigation.toJSON() : null,
          paints,
          resources,
          lcp: bench.lcp,
          cls: bench.layoutShifts.reduce((sum, entry) => sum + entry.value, 0),
          layoutShifts: bench.layoutShifts,
          workers: bench.workers.map((worker) => ({
            ...worker,
            createToPostMessageMs: worker.postedAt ? worker.postedAt - worker.createdAt : 0,
            postMessageToFirstProgressMs: worker.firstProgressAt && worker.postedAt
              ? worker.firstProgressAt - worker.postedAt
              : 0,
            createToFirstProgressMs: worker.firstProgressAt
              ? worker.firstProgressAt - worker.createdAt
              : 0,
            createToResultMs: worker.resultAt ? worker.resultAt - worker.createdAt : 0,
          })),
          longTasks: bench.longTasks,
        };
      };
    })();
  `;
}

function summarizeRequests(requestMap, pageUrl, options = {}) {
  const pageOrigin = new URL(pageUrl).origin;
  const documentUrl = new URL(pageUrl).href;
  const allowedRequestUrls = options.allowedRequestUrls
    ? new Set([documentUrl, ...options.allowedRequestUrls])
    : null;
  const zeroTransferUrls = new Set(options.zeroTransferUrls || []);
  const requests = [...requestMap.values()]
    .filter((request) => shouldIncludeRequest(request.url))
    .filter((request) => !allowedRequestUrls || allowedRequestUrls.has(request.url))
    .filter((request) => !isAnalyzerWorkerModuleRequest(request.url))
    .map((request) => ({
      ...request,
      encodedDataLength: zeroTransferUrls.has(request.url) ? 0 : request.encodedDataLength,
      url: normalizeRequestUrl(request.url, pageOrigin),
      sameOrigin: isSameOriginRequest(request.url, pageOrigin),
      cacheControl: readHeader(request.headers, "cache-control"),
      contentEncoding: readHeader(request.headers, "content-encoding"),
      cfCacheStatus: readHeader(request.headers, "cf-cache-status"),
      serverTiming: readHeader(request.headers, "server-timing"),
    }))
    .sort((a, b) => a.startTime - b.startTime || a.url.localeCompare(b.url));
  const byType = {};
  let totalTransferBytes = 0;
  let scriptTransferBytes = 0;

  for (const request of requests) {
    byType[request.type] ||= {
      count: 0,
      transferBytes: 0,
    };
    byType[request.type].count += 1;
    byType[request.type].transferBytes += request.encodedDataLength;
    totalTransferBytes += request.encodedDataLength;
    if (request.type === "Script") {
      scriptTransferBytes += request.encodedDataLength;
    }
  }

  return {
    count: requests.length,
    totalTransferBytes,
    scriptCount: requests.filter((request) => request.type === "Script").length,
    scriptTransferBytes,
    byType,
    urls: requests.map((request) => ({
      url: request.url,
      type: request.type,
      transferBytes: request.encodedDataLength,
      status: request.status,
      mimeType: request.mimeType,
      sameOrigin: request.sameOrigin,
      cacheControl: request.cacheControl,
      contentEncoding: request.contentEncoding,
      cfCacheStatus: request.cfCacheStatus,
      serverTiming: request.serverTiming,
    })),
  };
}

function isAnalyzerWorkerModuleRequest(url) {
  try {
    const path = new URL(url).pathname;
    return /^\/assets\/(?:apk-analyzer|libchecker-rules-core|libchecker-sdk-icons|sdk-markers)-[^/]+\.js$/u.test(path);
  } catch {
    return false;
  }
}

function shouldIncludeRequest(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/u.test(parsed.protocol)) {
      return false;
    }
    return parsed.hostname !== "local.adguard.org";
  } catch {
    return false;
  }
}

function isSameOriginRequest(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function normalizeRequestUrl(url, origin) {
  try {
    const parsed = new URL(url);
    if (parsed.origin === origin) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Keep the original URL below.
  }
  return url;
}

function readHeader(headers, name) {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === expected) {
      return Array.isArray(value) ? value.join(", ") : String(value || "");
    }
  }
  return "";
}

function printSummary(result, outputPath) {
  const navigation = result.firstScreen.metrics.navigation || {};
  const paints = result.firstScreen.metrics.paints || {};
  console.log(`Benchmark ${result.label}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Dist JS: ${formatBytes(result.dist.jsBytes)} raw, ${formatBytes(result.dist.jsGzipBytes)} gzip (${result.dist.jsFileCount} files)`);
  console.log(`Initial requests: ${result.firstScreen.requests.count}, script requests: ${result.firstScreen.requests.scriptCount}`);
  const lcp = result.firstScreen.metrics.lcp?.at(-1)?.startTime;
  console.log(`FCP: ${formatMs(paints["first-contentful-paint"])}, LCP: ${formatMs(lcp)}, CLS: ${(result.firstScreen.metrics.cls || 0).toFixed(3)}, load: ${formatMs(navigation.loadEventEnd)}`);
  for (const sample of result.samples) {
    const worker = sample.flow.worker || {};
    console.log([
      `${sample.name}:`,
      `wall ${formatMs(sample.wallTimeMs)}`,
      `worker ${formatMs(worker.createToFirstProgressMs)}`,
      `analysis ${formatMs(worker.resultDurationMs)}`,
      `ui ${formatMs(sample.flow.workerResultToVisibleMs)}`,
      sample.flow.error ? `error "${sample.flow.error}"` : "ok",
    ].join(" "));
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMs(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "n/a";
  }
  return `${Math.round(value)}ms`;
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function normalizePath(path) {
  return path.split(sep).join("/");
}
