import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { env } from "node:process";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

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
const chrome = await launchChrome();

try {
  const browser = await connectBrowser(chrome.debugPort);
  const pageUrl = remoteUrl || `http://127.0.0.1:${server.port}/`;
  const firstScreen = await measureFirstScreen(browser, pageUrl);
  const samples = [];

  for (const samplePath of existingSamples) {
    samples.push(await measureSample(browser, pageUrl, samplePath));
  }

  await browser.close();

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
  try {
    chrome.child.kill("SIGTERM");
  } catch {
    // Chrome may already have exited after Browser.close.
  }
  if (server) {
    await server.close();
  }
  await rm(chrome.userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 150,
  }).catch(() => {});
}

function parseArgs(args) {
  const parsed = {
    dist: "",
    label: "",
    output: "",
    samples: [],
    url: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dist") {
      parsed.dist = args[++index] || "";
    } else if (arg === "--label") {
      parsed.label = args[++index] || "";
    } else if (arg === "--output") {
      parsed.output = args[++index] || "";
    } else if (arg === "--sample") {
      parsed.samples.push(args[++index] || "");
    } else if (arg === "--url") {
      parsed.url = args[++index] || "";
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown benchmark option: ${arg}`);
    }
  }

  parsed.samples = parsed.samples.filter(Boolean);
  return parsed;
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

async function launchChrome() {
  const chromePath = await findChrome();
  const userDataDir = await mkdtemp(join(tmpdir(), "tgbot-webui-chrome-"));
  const debugPort = await findFreePort();
  const child = spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-popup-blocking",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], {
    stdio: "ignore",
  });

  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.warn(`Chrome exited with ${signal || `code ${code}`}`);
    }
  });

  await waitForChrome(debugPort);
  return { child, debugPort, userDataDir };
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

async function findFreePort() {
  const probe = createServer();
  return new Promise((resolvePort, rejectPort) => {
    probe.on("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForChrome(port) {
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(versionUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Chrome may still be booting.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome DevTools endpoint");
}

async function connectBrowser(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  const version = await response.json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });

  const pending = new Map();
  const eventHandlers = [];
  let nextId = 0;
  const browser = {
    send,
    __benchmarkEventHandlers: eventHandlers,
    async close() {
      try {
        await send("Browser.close");
      } catch {
        socket.close();
      }
    },
  };

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolveMessage, rejectMessage } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        rejectMessage(new Error(message.error.message));
      } else {
        resolveMessage(message.result || {});
      }
      return;
    }

    if (message.method) {
      for (const handler of eventHandlers) {
        handler(message);
      }
    }
  });

  function send(method, params = {}, sessionId = "") {
    nextId += 1;
    const payload = { id: nextId, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    socket.send(JSON.stringify(payload));
    return new Promise((resolveMessage, rejectMessage) => {
      pending.set(nextId, { resolveMessage, rejectMessage });
    });
  }

  return browser;
}

async function createPage(browser, url) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const events = createEventCollector(browser, sessionId);

  await browser.send("Page.enable", {}, sessionId);
  await browser.send("DOM.enable", {}, sessionId);
  await browser.send("Network.enable", {}, sessionId);
  await browser.send("Network.setBlockedURLs", {
    urls: [
      "http://local.adguard.org/*",
      "https://local.adguard.org/*",
    ],
  }, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", {
    source: createBenchmarkInjectionScript(),
  }, sessionId);
  await browser.send("Network.clearBrowserCache", {}, sessionId);
  await browser.send("Network.clearBrowserCookies", {}, sessionId);
  await browser.send("Page.navigate", { url }, sessionId);
  await events.waitFor("Page.loadEventFired", 30_000);

  return {
    sessionId,
    events,
    evaluate: (expression, awaitPromise = true) => browser.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    }, sessionId).then((result) => {
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
      }
      return result.result?.value;
    }),
    close: () => browser.send("Target.closeTarget", { targetId }),
  };
}

function createEventCollector(browser, sessionId) {
  const network = new Map();
  const waiters = new Map();

  const eventHandler = (message) => {
    if (message.sessionId !== sessionId) {
      return;
    }
    const waitList = waiters.get(message.method);
    if (waitList) {
      waiters.delete(message.method);
      for (const waiter of waitList) {
        waiter(message.params || {});
      }
    }

    if (message.method === "Network.requestWillBeSent") {
      network.set(message.params.requestId, {
        requestId: message.params.requestId,
        url: message.params.request.url,
        type: message.params.type,
        method: message.params.request.method,
        startTime: message.params.timestamp,
        status: 0,
        mimeType: "",
        encodedDataLength: 0,
        fromDiskCache: false,
        fromMemoryCache: false,
        headers: {},
      });
    } else if (message.method === "Network.responseReceived") {
      const entry = network.get(message.params.requestId);
      if (entry) {
        entry.status = message.params.response.status;
        entry.mimeType = message.params.response.mimeType || "";
        entry.fromDiskCache = Boolean(message.params.response.fromDiskCache);
        entry.fromMemoryCache = Boolean(message.params.response.fromMemoryCache);
        entry.headers = message.params.response.headers || {};
      }
    } else if (message.method === "Network.loadingFinished") {
      const entry = network.get(message.params.requestId);
      if (entry) {
        entry.encodedDataLength = message.params.encodedDataLength || 0;
        entry.endTime = message.params.timestamp;
      }
    }
  };

  browser.__benchmarkEventHandlers.push(eventHandler);

  return {
    requests: network,
    waitFor(method, timeoutMs) {
      return new Promise((resolveWait, rejectWait) => {
        const timeout = setTimeout(() => {
          rejectWait(new Error(`Timed out waiting for ${method}`));
        }, timeoutMs);
        const wrapped = (params) => {
          clearTimeout(timeout);
          resolveWait(params);
        };
        const waitList = waiters.get(method) || [];
        waitList.push(wrapped);
        waiters.set(method, waitList);
      });
    },
    dispose() {
      const handlers = browser.__benchmarkEventHandlers || [];
      const index = handlers.indexOf(eventHandler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    },
  };
}

async function measureFirstScreen(browser, pageUrl) {
  const page = await createPage(browser, pageUrl);
  await delay(2500);
  const metrics = await page.evaluate("window.__webuiBenchmarkSnapshot()");
  const requests = summarizeRequests(page.events.requests, pageUrl);
  await page.close();
  page.events.dispose();
  return {
    metrics,
    requests,
  };
}

async function measureSample(browser, pageUrl, samplePath) {
  const page = await createPage(browser, pageUrl);
  await delay(500);
  const inputNodeId = await querySelectorNodeId(browser, page.sessionId, "#file-input");
  const startedAt = Date.now();
  await browser.send("DOM.setFileInputFiles", {
    nodeId: inputNodeId,
    files: [samplePath],
  }, page.sessionId);
  await page.evaluate("document.querySelector('#file-input').dispatchEvent(new Event('change', { bubbles: true }))");
  await page.evaluate("document.querySelector('#analyze-form').requestSubmit()");

  const flow = await waitForAnalysis(page, 180_000);
  const requests = summarizeRequests(page.events.requests, pageUrl);
  await page.close();
  page.events.dispose();

  return {
    name: basename(samplePath),
    path: samplePath,
    fileBytes: (await stat(samplePath)).size,
    wallTimeMs: Date.now() - startedAt,
    flow,
    requests,
  };
}

async function querySelectorNodeId(browser, sessionId, selector) {
  const { root } = await browser.send("DOM.getDocument", { depth: 1 }, sessionId);
  const { nodeId } = await browser.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  }, sessionId);
  if (!nodeId) {
    throw new Error(`Could not find ${selector}`);
  }
  return nodeId;
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

function summarizeRequests(requestMap, pageUrl) {
  const pageOrigin = new URL(pageUrl).origin;
  const requests = [...requestMap.values()]
    .filter((request) => shouldIncludeRequest(request.url))
    .map((request) => ({
      ...request,
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
