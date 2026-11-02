import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readAndroidPackageInfo } from "../../shared/src/apk.js";
import { createSdkMarkerAnnotator } from "../../shared/src/sdk-markers.js";
import { LIBCHECKER_RULES_CORE } from "../../shared/src/generated/libchecker-rules-core.js";
import { createMcpReport } from "../../shared/src/mcp-report.js";

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
let busy = false;

export async function analyzeFile(args, signal) {
  if (busy) throw new Error("Another APK analysis is running; retry after it finishes.");
  signal?.throwIfAborted();
  busy = true;
  let worker;
  let timer;
  let abort;
  try {
    worker = new Worker(new URL(import.meta.url), {
      workerData: args,
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    return await new Promise((resolve, reject) => {
      abort = () => reject(new Error("APK analysis cancelled."));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => reject(new Error("APK analysis exceeded 60 seconds.")), 60_000);
      worker.once("message", (message) => message.error ? reject(new Error(message.error)) : resolve(message.result));
      worker.once("error", () => reject(new Error("APK analysis worker failed.")));
      worker.once("exit", () => reject(new Error("APK analysis worker exited before completing.")));
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    try { await worker?.terminate(); } finally { busy = false; }
  }
}

async function readLocalReport({ path, ...selection }) {
  if (!isAbsolute(path) || ![".apk", ".apks", ".apkm", ".xapk"].includes(extname(path).toLowerCase())) {
    throw new Error("Provide an absolute APK/APKS/APKM/XAPK file path.");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
      throw new Error("APK must be a regular file between 1 byte and 512 MiB.");
    }
    const bytes = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error("APK changed while being read.");
      offset += bytesRead;
    }
    const after = await file.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("APK changed while being read.");
    const apkInfo = await readAndroidPackageInfo(bytes, { maxExtractedBytes: MAX_EXTRACTED_BYTES });
    const annotate = createSdkMarkerAnnotator(LIBCHECKER_RULES_CORE);
    return createMcpReport({
      fileName: basename(path), fileSizeBytes: stat.size,
      apkInfo: { ...apkInfo, ...annotate(apkInfo, () => "") },
    }, selection);
  } finally {
    await file.close();
  }
}

if (!isMainThread) {
  // No network access is needed for file parsing or the bundled rule lookup.
  globalThis.fetch = async () => { throw new Error("Network access is disabled for local APK analysis."); };
  try {
    parentPort.postMessage({ result: await readLocalReport(workerData) });
  } catch (error) {
    const safeMessage = error?.code ? "Cannot read APK file." : "Cannot analyze APK: invalid package or resource limit exceeded.";
    parentPort.postMessage({ error: safeMessage });
  }
}
