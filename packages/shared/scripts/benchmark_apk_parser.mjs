import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs as parseCliArgs } from "node:util";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoDir = resolve(packageDir, "../..");
const defaultSrcDir = resolve(packageDir, "src");
const textEncoder = new TextEncoder();
const ZIP_ENTRY_COUNT = 10_000;
const SIGNATURE_ENTRY_COUNT = 800;
const DEX_CLASS_COUNT = 80_000;

const options = parseArgs(process.argv.slice(2));
const suites = [];
let baselineDir = null;

try {
  if (options.compareHead) {
    baselineDir = await extractHeadSharedSrc();
    suites.push(await runSuite("before:HEAD", baselineDir));
  }

  suites.push(await runSuite(options.label, options.srcDir));
  printResults(suites);
} finally {
  if (baselineDir) {
    await rm(resolve(baselineDir, ".."), { recursive: true, force: true }).catch(() => {});
  }
}

function parseArgs(args) {
  const { values } = parseCliArgs({
    args,
    options: {
      "compare-head": { type: "boolean" },
      "src-dir": { type: "string" },
      label: { type: "string" },
      iterations: { type: "string" },
      warmup: { type: "string" },
      sample: { type: "string", multiple: true },
      help: { type: "boolean" },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  return {
    compareHead: values["compare-head"] || false,
    srcDir: values["src-dir"] ? resolve(repoDir, values["src-dir"]) : defaultSrcDir,
    label: values.label || "after:worktree",
    iterations: Math.max(5, Number(values.iterations) || 60),
    warmup: Math.max(0, Number(values.warmup) || 8),
    samples: (values.sample || []).map((sample) => resolve(sample)),
  };
}

function printHelp() {
  console.log([
    "Usage: node packages/shared/scripts/benchmark_apk_parser.mjs [options]",
    "",
    "Options:",
    "  --compare-head        Compare current worktree against HEAD shared parser sources",
    "  --src-dir <path>      Shared src directory to benchmark",
    "  --label <name>        Label for the current suite",
    "  --iterations <count>  Timed iterations per case",
    "  --warmup <count>      Warmup iterations per case",
    "  --sample <path>       APK/APKS sample path; may be repeated",
  ].join("\n"));
}

async function extractHeadSharedSrc() {
  const root = await mkdtemp(resolve(tmpdir(), "tgbot-parser-bench-"));
  const srcDir = resolve(root, "src");
  await writeFile(resolve(root, "package.json"), "{\"type\":\"module\"}\n");
  await mkdir(srcDir, { recursive: true });
  await writeHeadFile(srcDir, "apk.js");
  await writeHeadFile(srcDir, "apk-signatures.js");
  return srcDir;
}

async function writeHeadFile(srcDir, fileName) {
  const bytes = execFileSync("git", [
    "show",
    `HEAD:packages/shared/src/${fileName}`,
  ], {
    cwd: repoDir,
    maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(resolve(srcDir, fileName), bytes);
}

async function runSuite(label, srcDir) {
  const apkModule = await importFresh(resolve(srcDir, "apk.js"));
  const signaturesModule = await importFresh(resolve(srcDir, "apk-signatures.js"));
  const zipBytes = createStoredZip(createZipEntries(ZIP_ENTRY_COUNT));
  const signatureSource = createSignatureSource(SIGNATURE_ENTRY_COUNT);
  const dexSource = createDexSource(DEX_CLASS_COUNT);
  const samples = await loadSamples(options.samples);
  const cases = [];

  if (typeof apkModule.__apkTestInternals?.parseZipEntries === "function") {
    cases.push(await measureCase(`zip.parse.${ZIP_ENTRY_COUNT}_entries`, () => {
      const entries = apkModule.__apkTestInternals.parseZipEntries(zipBytes);
      if (entries.size === 0) {
        throw new Error("ZIP parse produced no entries");
      }
    }));
  }

  if (typeof signaturesModule.readApkSignatures === "function") {
    cases.push(await measureCase(`signature.v1_scan.${SIGNATURE_ENTRY_COUNT}_entries`, async () => {
      const signatures = await signaturesModule.readApkSignatures(signatureSource);
      if (!signatures.schemes.includes("V1")) {
        throw new Error("signature scan missed V1");
      }
    }, {
      iterations: Math.max(10, Math.floor(options.iterations / 2)),
    }));
  }

  if (typeof apkModule.__apkTestInternals?.scanDexFeatureMarkers === "function") {
    cases.push(await measureCase(`dex.scan_js.${DEX_CLASS_COUNT}_classes`, async () => {
      const markers = await apkModule.__apkTestInternals.scanDexFeatureMarkers(dexSource);
      if (!markers.composeDetected) {
        throw new Error("DEX scan missed compose marker");
      }
    }));

    cases.push(await measureCase(`dex.scan_hook_bypass.${DEX_CLASS_COUNT}_classes`, async () => {
      const markers = await apkModule.__apkTestInternals.scanDexFeatureMarkers(dexSource, {
        parserProfile: {
          scanDexFeatureMarkers: () => ({
            kotlinDetected: false,
            composeDetected: true,
            nativeValidation: {
              qihooDetected: false,
              secneoDetected: false,
              flutterInjectorDetected: false,
            },
          }),
        },
      });
      if (!markers.composeDetected) {
        throw new Error("DEX hook missed compose marker");
      }
    }));
  }

  if (typeof apkModule.readAndroidPackageInfo === "function") {
    for (const sample of samples) {
      cases.push(await measureCase(`apk.parse.${sample.name}`, async () => {
        const info = await apkModule.readAndroidPackageInfo(sample.bytes);
        if (!info?.packageName) {
          throw new Error(`APK parse missed package name for ${sample.name}`);
        }
      }, {
        iterations: Math.min(options.iterations, 8),
        warmup: Math.min(options.warmup, 1),
      }));

      cases.push(await measureCase(`apk.profile.${sample.name}`, async () => {
        const parserProfile = { stages: [] };
        const info = await apkModule.readAndroidPackageInfo(sample.bytes, { parserProfile });
        if (!info?.packageName) {
          throw new Error(`APK parse missed package name for ${sample.name}`);
        }
        return parserProfile;
      }, {
        iterations: Math.min(options.iterations, 5),
        warmup: Math.min(options.warmup, 1),
      }));
    }
  }

  return {
    label,
    srcDir: relative(repoDir, srcDir),
    cases,
  };
}

async function loadSamples(samplePaths) {
  const samples = [];
  for (const samplePath of samplePaths) {
    try {
      const sampleStat = await stat(samplePath);
      if (!sampleStat.isFile()) {
        continue;
      }
      samples.push({
        name: samplePath.split(/[\\/]/u).at(-1) || "sample.apk",
        path: samplePath,
        bytes: await readFile(samplePath),
      });
    } catch {
      // Missing optional benchmark samples are skipped.
    }
  }
  return samples;
}

function importFresh(path) {
  return import(`${pathToFileURL(path).href}?benchmark=${Date.now()}-${Math.random()}`);
}

async function measureCase(name, action, caseOptions = {}) {
  const iterations = caseOptions.iterations || options.iterations;
  const warmup = caseOptions.warmup ?? options.warmup;
  for (let index = 0; index < warmup; index += 1) {
    await action();
  }

  const samples = [];
  const stageProfiles = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const result = await action();
    samples.push(performance.now() - startedAt);
    if (Array.isArray(result?.stages)) {
      stageProfiles.push(result.stages);
    }
  }

  samples.sort((left, right) => left - right);
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    name,
    iterations,
    medianMs: percentile(samples, 0.5),
    meanMs: sum / samples.length,
    p95Ms: percentile(samples, 0.95),
    minMs: samples[0],
    stageSummary: summarizeStageProfiles(stageProfiles),
  };
}

function summarizeStageProfiles(stageProfiles) {
  if (stageProfiles.length === 0) {
    return [];
  }

  const samplesByStage = new Map();
  for (const stages of stageProfiles) {
    const totals = new Map();
    for (const entry of stages) {
      const stage = String(entry.stage || "");
      const durationMs = Number(entry.durationMs) || 0;
      if (!stage || durationMs <= 0) {
        continue;
      }
      totals.set(stage, (totals.get(stage) || 0) + durationMs);
    }

    for (const [stage, durationMs] of totals.entries()) {
      if (!samplesByStage.has(stage)) {
        samplesByStage.set(stage, []);
      }
      samplesByStage.get(stage).push(durationMs);
    }
  }

  const summary = [];
  for (const [stage, samples] of samplesByStage.entries()) {
    samples.sort((left, right) => left - right);
    const sum = samples.reduce((total, value) => total + value, 0);
    summary.push({
      stage,
      medianMs: percentile(samples, 0.5),
      meanMs: sum / samples.length,
      p95Ms: percentile(samples, 0.95),
      n: samples.length,
    });
  }
  summary.sort((left, right) => right.medianMs - left.medianMs || left.stage.localeCompare(right.stage));
  return summary;
}

function percentile(samples, ratio) {
  if (samples.length === 0) {
    return 0;
  }
  const index = Math.min(samples.length - 1, Math.floor((samples.length - 1) * ratio));
  return samples[index];
}

function printResults(suites) {
  console.log("APK parser benchmark (milliseconds, lower is better)");
  for (const suite of suites) {
    console.log(`\n${suite.label} (${suite.srcDir})`);
    printCaseTable(suite.cases);
  }

  if (suites.length >= 2) {
    console.log("\ncomparison (median)");
    printComparison(suites[0], suites.at(-1));
  }
}

function printCaseTable(cases) {
  console.log(pad("case", 34), pad("median", 10), pad("mean", 10), pad("p95", 10), "n");
  for (const item of cases) {
    console.log(
      pad(item.name, 34),
      pad(formatMs(item.medianMs), 10),
      pad(formatMs(item.meanMs), 10),
      pad(formatMs(item.p95Ms), 10),
      String(item.iterations),
    );
  }

  for (const item of cases) {
    if (item.stageSummary?.length) {
      console.log(`\nstages: ${item.name}`);
      printStageTable(item.stageSummary);
    }
  }
}

function printStageTable(stages) {
  console.log(pad("stage", 38), pad("median", 10), pad("mean", 10), pad("p95", 10), "n");
  for (const item of stages) {
    console.log(
      pad(item.stage, 38),
      pad(formatMs(item.medianMs), 10),
      pad(formatMs(item.meanMs), 10),
      pad(formatMs(item.p95Ms), 10),
      String(item.n),
    );
  }
}

function printComparison(before, after) {
  const beforeByName = new Map(before.cases.map((item) => [item.name, item]));
  console.log(pad("case", 34), pad("before", 10), pad("after", 10), "delta");
  for (const item of after.cases) {
    if (item.name.startsWith("apk.profile.")) {
      continue;
    }
    const baseline = beforeByName.get(item.name);
    if (!baseline) {
      console.log(pad(item.name, 34), pad("n/a", 10), pad(formatMs(item.medianMs), 10), "n/a");
      continue;
    }
    const delta = ((item.medianMs - baseline.medianMs) / baseline.medianMs) * 100;
    console.log(
      pad(item.name, 34),
      pad(formatMs(baseline.medianMs), 10),
      pad(formatMs(item.medianMs), 10),
      `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
    );
  }
}

function pad(value, width) {
  return String(value).padEnd(width, " ");
}

function formatMs(value) {
  return value.toFixed(3);
}

function createZipEntries(count) {
  const entries = [
    ["AndroidManifest.xml", new Uint8Array([1])],
    ["resources.arsc", new Uint8Array([2])],
    ["classes.dex", new Uint8Array([3])],
    ["META-INF/CERT.RSA", new Uint8Array([4])],
  ];
  for (let index = 0; index < count; index += 1) {
    entries.push([`res/raw/item_${String(index).padStart(4, "0")}.xml`, new Uint8Array([index & 0xff])]);
  }
  return entries;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [path, data] of entries) {
    const nameBytes = textEncoder.encode(path);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(18, data.byteLength, true);
    localView.setUint32(22, data.byteLength, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);

    const centralDirectory = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralDirectory.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, data.byteLength, true);
    centralView.setUint32(24, data.byteLength, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralDirectory.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralDirectory);
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralDirectorySize, true);
  eocdView.setUint32(16, centralDirectoryOffset, true);

  return concatBytes(...localParts, ...centralParts, eocd);
}

function createSignatureSource(count) {
  const signatureBytes = new Uint8Array(512);
  signatureBytes[0] = 0x30;
  signatureBytes[1] = 0x82;
  const zipEntries = new Map();

  for (let index = 0; index < count; index += 1) {
    const path = `META-INF/CERT${String(index).padStart(4, "0")}.RSA`;
    zipEntries.set(path, {
      path,
      uncompressedSize: signatureBytes.byteLength,
      compressedSize: signatureBytes.byteLength,
    });
  }

  return {
    zipEntries,
    extractEntry: async () => signatureBytes,
  };
}

function createDexSource(classCount) {
  const dexBytes = createDexBytes(classCount);
  return {
    zipEntries: new Map([
      ["classes.dex", {
        path: "classes.dex",
        uncompressedSize: dexBytes.byteLength,
        compressedSize: dexBytes.byteLength,
      }],
    ]),
    extractEntry: async () => dexBytes,
  };
}

function createDexBytes(classCount) {
  const descriptors = Array.from({ length: classCount }, (_, index) =>
    index === classCount - 1
      ? "Landroidx/compose/runtime/Composer;"
      : `Lcom/example/Generated${String(index).padStart(5, "0")};`
  );
  const headerSize = 0x70;
  const stringIdsOffset = headerSize;
  const stringIdsSize = descriptors.length;
  const typeIdsOffset = stringIdsOffset + stringIdsSize * 4;
  const typeIdsSize = descriptors.length;
  const classDefsOffset = typeIdsOffset + typeIdsSize * 4;
  const classDefsSize = descriptors.length;
  let dataOffset = classDefsOffset + classDefsSize * 32;
  const stringDataOffsets = [];
  let stringDataSize = 0;

  for (const descriptor of descriptors) {
    stringDataOffsets.push(dataOffset + stringDataSize);
    stringDataSize += getUleb128Size(descriptor.length) + descriptor.length + 1;
  }

  const bytes = new Uint8Array(dataOffset + stringDataSize);
  const view = new DataView(bytes.buffer);
  view.setUint32(0x38, stringIdsSize, true);
  view.setUint32(0x3c, stringIdsOffset, true);
  view.setUint32(0x40, typeIdsSize, true);
  view.setUint32(0x44, typeIdsOffset, true);
  view.setUint32(0x60, classDefsSize, true);
  view.setUint32(0x64, classDefsOffset, true);

  for (let index = 0; index < descriptors.length; index += 1) {
    view.setUint32(stringIdsOffset + index * 4, stringDataOffsets[index], true);
    view.setUint32(typeIdsOffset + index * 4, index, true);
    view.setUint32(classDefsOffset + index * 32, index, true);
    dataOffset = writeDexString(bytes, stringDataOffsets[index], descriptors[index]);
  }

  return bytes;
}

function writeDexString(bytes, offset, text) {
  let cursor = writeUleb128(bytes, offset, text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[cursor] = text.charCodeAt(index) & 0x7f;
    cursor += 1;
  }
  bytes[cursor] = 0;
  return cursor + 1;
}

function writeUleb128(bytes, offset, value) {
  let cursor = offset;
  let remaining = value >>> 0;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes[cursor] = byte;
    cursor += 1;
  } while (remaining !== 0);
  return cursor;
}

function getUleb128Size(value) {
  let size = 0;
  let remaining = value >>> 0;
  do {
    remaining >>>= 7;
    size += 1;
  } while (remaining !== 0);
  return size;
}

function concatBytes(...chunks) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
