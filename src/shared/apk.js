import { readApkSignatures } from "./apk-signatures.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const ZIP_NO_ENTRY = 0xffffffff;

const RES_STRING_POOL_TYPE = 0x0001;
const RES_TABLE_TYPE = 0x0002;
const RES_XML_TYPE = 0x0003;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;

const STRING_POOL_UTF8_FLAG = 1 << 8;
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_DIMENSION = 0x05;
const TYPE_DYNAMIC_REFERENCE = 0x07;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;
const TYPE_FIRST_COLOR_INT = 0x1c;
const TYPE_LAST_COLOR_INT = 0x1f;

const TYPE_FLAG_SPARSE = 0x01;
const TYPE_FLAG_OFFSET16 = 0x02;
const ENTRY_FLAG_COMPLEX = 0x0001;
const ENTRY_FLAG_COMPACT = 0x0008;

const AXML_NO_INDEX = 0xffffffff;
const TABLE_NO_ENTRY_16 = 0xffff;

const utf8Decoder = new TextDecoder();
// Keep this order aligned with LibChecker's getJetpackComposeVersion().
const COMPOSE_VERSION_ENTRY_CANDIDATES = [
  "META-INF/androidx.compose.runtime_runtime.version",
  "META-INF/androidx.compose.ui_ui.version",
  "META-INF/androidx.compose.ui_ui-tooling-preview.version",
  "META-INF/androidx.compose.foundation_foundation.version",
  "META-INF/androidx.compose.animation_animation.version",
];
const MAX_APP_ICON_BYTES = 128 * 1024;
const ADAPTIVE_ICON_SIZE = 108;
const ADAPTIVE_ICON_EXTRA_INSET_PERCENTAGE = 1 / 4;
const ADAPTIVE_ICON_VIEW_PORT_SCALE = 1 / (1 + 2 * ADAPTIVE_ICON_EXTRA_INSET_PERCENTAGE);
const ADAPTIVE_ICON_EDGE_INSET = 0.5;
const ADAPTIVE_ICON_EDGE_FEATHER = 1;

export async function readAndroidPackageInfo(packageBuffer) {
  const packageBytes = toUint8Array(packageBuffer);
  const zipEntries = parseZipEntries(packageBytes);

  if (isDirectApkZip(zipEntries)) {
    return readApkInfoFromParsedZip(packageBytes, zipEntries);
  }

  const apkEntries = collectContainedApkEntries(zipEntries);
  return readPackageContainerInfo(packageBytes, apkEntries);
}

export async function readApkInfo(apkBuffer) {
  const apkBytes = toUint8Array(apkBuffer);
  const zipEntries = parseZipEntries(apkBytes);
  return readApkInfoFromParsedZip(apkBytes, zipEntries);
}

function readApkInfoFromParsedZip(apkBytes, zipEntries) {
  return readApkInfoFromZipSource(
    {
      zipEntries,
      extractEntry: (entry) => extractZipEntry(apkBytes, entry),
      apkBytes,
    },
    {
      scanDex: true,
    },
  );
}

async function readPackageContainerInfo(packageBytes, apkEntries) {
  const apkSources = await extractContainedApkSources(packageBytes, apkEntries);
  const selectedSource = selectContainedApkSource(apkSources);
  if (!selectedSource) {
    throw new Error("Android 包中未找到可解析的 APK 文件");
  }

  const apkInfo = await readApkInfoFromZipSource(selectedSource, {
    scanDex: true,
    iconSource: buildContainedIconSource(apkSources, selectedSource),
    iconResources: await readContainedIconResources(apkSources, selectedSource),
  });
  const nativeLibraries = collectContainedNativeLibraries(apkSources);

  return {
    ...apkInfo,
    nativeLibraries,
    archive: {
      type: "package-container",
      analyzedEntry: selectedSource.path,
      apkEntryCount: apkEntries.length,
      apkEntries: apkEntries.map((item) => item.path),
      apkEntryDetails: apkEntries.map((item) => buildArchiveApkEntryDetail(item, selectedSource.path)),
    },
  };
}

function buildArchiveApkEntryDetail(apkEntry, analyzedPath) {
  const size = apkEntry.entry.uncompressedSize || apkEntry.entry.compressedSize || 0;
  return {
    path: apkEntry.path,
    name: getContainedApkFileName(apkEntry.path),
    size,
    compressedSize: apkEntry.entry.compressedSize || 0,
    uncompressedSize: apkEntry.entry.uncompressedSize || 0,
    analyzed: apkEntry.path === analyzedPath,
  };
}

async function extractContainedApkSources(packageBytes, apkEntries) {
  const sources = [];
  for (const apkEntry of apkEntries) {
    try {
      sources.push(await extractContainedApkSource(packageBytes, apkEntry));
    } catch {
      // Keep parsing other entries in APKS/APKM/XAPK containers when one split is unusable.
    }
  }
  return sources;
}

async function extractContainedApkSource(packageBytes, apkEntry) {
  const apkBytes = await extractZipEntry(packageBytes, apkEntry.entry);
  const zipEntries = parseZipEntries(apkBytes);
  return {
    path: apkEntry.path,
    apkBytes,
    zipEntries,
    extractEntry: (entry) => extractZipEntry(apkBytes, entry),
  };
}

async function readContainedIconResources(apkSources, selectedSource) {
  const resources = [];
  const orderedSources = [
    selectedSource,
    ...apkSources.filter((source) => source !== selectedSource),
  ];

  for (const source of orderedSources) {
    const parsed = await readApkResources(source);
    if (parsed) {
      resources.push(parsed);
    }
  }

  return combineResourceResolvers(resources);
}

function combineResourceResolvers(resources) {
  const resolvers = resources.filter(Boolean);
  if (resolvers.length <= 1) {
    return resolvers[0] || null;
  }

  return {
    resolveString(resourceId) {
      for (const resolver of resolvers) {
        const value = resolver.resolveString(resourceId);
        if (value) {
          return value;
        }
      }
      return null;
    },
    resolveFiles(resourceId) {
      const files = [];
      const seen = new Set();
      for (const resolver of resolvers) {
        for (const file of resolver.resolveFiles(resourceId)) {
          const key = `${file.path}\u0000${file.typeName}\u0000${file.density}\u0000${file.isDefaultConfig}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          files.push(file);
        }
      }
      return files;
    },
    resolveColor(resourceId) {
      for (const resolver of resolvers) {
        const value = resolver.resolveColor(resourceId);
        if (value) {
          return value;
        }
      }
      return null;
    },
  };
}

function buildContainedIconSource(apkSources, selectedSource) {
  const sourcesByPath = new Map(apkSources.map((source) => [source.path, source]));
  const zipEntries = new Map();
  const orderedSources = [
    selectedSource,
    ...apkSources.filter((source) => source !== selectedSource),
  ];

  for (const source of orderedSources) {
    for (const [path, entry] of source.zipEntries.entries()) {
      if (zipEntries.has(path)) {
        continue;
      }

      zipEntries.set(path, {
        ...entry,
        sourceEntry: source.path,
      });
    }
  }

  return {
    zipEntries,
    extractEntry(entry) {
      const source = sourcesByPath.get(entry.sourceEntry) || selectedSource;
      return extractZipEntry(source.apkBytes, entry);
    },
  };
}

function selectContainedApkSource(apkSources) {
  return [...apkSources]
    .sort((left, right) => (
      scoreContainedApkSource(left) - scoreContainedApkSource(right) ||
      left.path.localeCompare(right.path)
    ))[0] || null;
}

function scoreContainedApkSource(source) {
  let score = scoreContainedApkPath(source.path) * 100;

  if (!source.zipEntries.has("AndroidManifest.xml")) {
    score += 1000;
  }

  if (hasRootDexEntries(source.zipEntries)) {
    score -= 30;
  }

  if (source.zipEntries.has("resources.arsc")) {
    score -= 10;
  }

  return score;
}

function hasRootDexEntries(zipEntries) {
  for (const path of zipEntries.keys()) {
    if (/^classes\d*\.dex$/u.test(path)) {
      return true;
    }
  }
  return false;
}

function collectContainedNativeLibraries(apkSources) {
  const librariesByKey = new Map();

  for (const source of apkSources) {
    for (const library of collectNativeLibraries(source.zipEntries)) {
      const item = {
        ...library,
        sourceEntry: source.path,
      };
      const key = `${item.sourceEntry}\u0000${item.path}\u0000${item.abi}\u0000${item.name}`;
      librariesByKey.set(key, item);
    }
  }

  return [...librariesByKey.values()].sort(compareNativeLibraries);
}

function isDirectApkZip(zipEntries) {
  return zipEntries.has("AndroidManifest.xml");
}

function collectContainedApkEntries(zipEntries) {
  return [...zipEntries.entries()]
    .filter(([path]) => isContainedApkPath(path))
    .map(([path, entry]) => ({
      path,
      entry,
      score: scoreContainedApkPath(path),
    }))
    .sort((left, right) => (
      left.score - right.score ||
      left.path.localeCompare(right.path)
    ));
}

function isContainedApkPath(path) {
  const normalized = String(path || "").toLowerCase().replaceAll("\\", "/");
  return normalized.endsWith(".apk") && !normalized.startsWith("__macosx/");
}

function scoreContainedApkPath(path) {
  const fileName = getContainedApkFileName(path);

  if (fileName === "base.apk") {
    return 0;
  }

  if (fileName === "base-master.apk") {
    return 1;
  }

  if (/^base[-_.].+\.apk$/u.test(fileName)) {
    return 2;
  }

  if (fileName === "standalone.apk" || fileName.endsWith("-standalone.apk")) {
    return 3;
  }

  if (!isLikelySplitApkFileName(fileName)) {
    return 4;
  }

  return 5;
}

function getContainedApkFileName(path) {
  const normalized = String(path || "").toLowerCase();
  return normalized.split(/[\\/]/u).filter(Boolean).at(-1) || normalized;
}

function isLikelySplitApkFileName(fileName) {
  const stem = fileName.replace(/\.apk$/u, "");

  return (
    /(?:^|[-_.])(?:split|config|dpi|lang|armeabi|arm64|x86|mips|ldpi|mdpi|tvdpi|hdpi|xhdpi|xxhdpi|xxxhdpi|nodpi|anydpi)(?:[-_.]|$)/u.test(fileName) ||
    /^(?:armeabi|armeabi-v7a|arm64-v8a|x86|x86_64|mips|mips64)$/u.test(stem) ||
    /^(?:ldpi|mdpi|tvdpi|hdpi|xhdpi|xxhdpi|xxxhdpi|nodpi|anydpi)$/u.test(stem) ||
    /^[a-z]{2}(?:[-_][a-z0-9]{2,8})?$/u.test(stem)
  );
}

export async function readApkInfoFromZipSource(source, options = {}) {
  const zipEntries = source.zipEntries;
  const nativeLibraries = collectNativeLibraries(zipEntries);
  const buildFeatures = await detectBuildFeatures(source, options);
  const signatures = await readApkSignatures(source, {
    maxSignatureEntryBytes: options.maxSignatureEntryBytes,
  });
  const resources = await readApkResources(source, {
    maxEntryBytes: options.maxResourceBytes,
  });

  const manifestEntry = zipEntries.get("AndroidManifest.xml");
  if (!manifestEntry) {
    throw new Error("APK 中缺少 AndroidManifest.xml");
  }

  const manifestBytes = await extractSourceEntry(source, manifestEntry);
  const manifest = parseAndroidManifest(manifestBytes);

  let appName = normalizeText(manifest.applicationLabel);
  if (!appName && manifest.applicationLabelRef != null && resources) {
    appName = normalizeText(resources.resolveString(manifest.applicationLabelRef));
  }

  if (!appName && manifest.applicationLabelRef != null) {
    appName = formatResourceReference(manifest.applicationLabelRef);
  }

  const icon = await resolveApplicationIcon(
    options.iconSource || source,
    manifest,
    options.iconResources || resources,
  );

  const metaData = {
    application: resolveApplicationMetaData(manifest.metaData.application, resources),
    components: [],
  };

  return {
    appName: appName || "未知",
    packageName: normalizeText(manifest.packageName) || "未知",
    versionName: normalizeText(manifest.versionName) || "未知",
    versionCode: normalizeText(manifest.versionCode) || "未知",
    minSdk: normalizeText(manifest.minSdk) || "未知",
    targetSdk: normalizeText(manifest.targetSdk) || "未知",
    compileSdk: normalizeText(manifest.compileSdk) || "未知",
    icon,
    permissions: manifest.permissions,
    nativeLibraries,
    components: manifest.components,
    metaData,
    buildFeatures,
    signatures,
  };
}

async function detectBuildFeatures(source, options = {}) {
  const zipEntries = source.zipEntries;
  const appMetadata = await readAppMetadata(source);
  const composeMetadata = await readComposeMetadata(source);
  const shouldScanDex = options.scanDex !== false;
  const featureMarkers = shouldScanDex
    ? await scanDexFeatureMarkers(source, {
        skipComposeDexScan: composeMetadata.detected,
      })
    : buildZipOnlyFeatureMarkers(zipEntries, composeMetadata.detected);
  const kotlinTooling = await readKotlinToolingMetadata(source);

  return {
    kotlinDetected: featureMarkers.kotlinDetected || kotlinTooling.detected,
    kotlinVersion: kotlinTooling.kotlinVersion || null,
    gradleVersion: kotlinTooling.gradleVersion || null,
    composeDetected: composeMetadata.detected || featureMarkers.composeDetected,
    composeVersion: composeMetadata.composeVersion || null,
    agpVersion: appMetadata.androidGradlePluginVersion || null,
    appMetadataVersion: appMetadata.appMetadataVersion || null,
    nativeValidation: featureMarkers.nativeValidation,
  };
}

async function readAppMetadata(source) {
  const zipEntries = source.zipEntries;
  const metadataEntry =
    zipEntries.get("META-INF/com/android/build/gradle/app-metadata.properties") ||
    zipEntries.get("BUNDLE-METADATA/com.android.tools.build.gradle/app-metadata.properties");

  if (!metadataEntry) {
    return {
      appMetadataVersion: null,
      androidGradlePluginVersion: null,
    };
  }

  const metadataBytes = await extractSourceEntry(source, metadataEntry);
  const metadataText = decodeUtf8(metadataBytes);
  const properties = parseProperties(metadataText);

  return {
    appMetadataVersion: properties.appMetadataVersion || null,
    androidGradlePluginVersion: properties.androidGradlePluginVersion || null,
  };
}

async function scanDexFeatureMarkers(source, options = {}) {
  const zipEntries = source.zipEntries;
  let kotlinDetected = hasKotlinModule(zipEntries);
  let composeDetected = Boolean(options.skipComposeDexScan);
  let qihooDetected = false;
  let secneoDetected = false;
  let flutterInjectorDetected = false;

  const dexEntries = [...zipEntries.entries()]
    .filter(([path]) => /^classes\d*\.dex$/u.test(path))
    .sort(([left], [right]) => left.localeCompare(right));

  const kotlinNeedles = [
    "Lkotlin/Metadata;",
    "kotlin/Unit",
    "kotlin/coroutines/",
  ];

  for (const [, entry] of dexEntries) {
    if (kotlinDetected && composeDetected) {
      break;
    }

    const dexBytes = await extractSourceEntry(source, entry);

    if (!kotlinDetected && containsAnyAscii(dexBytes, kotlinNeedles)) {
      kotlinDetected = true;
    }

    const definedClassDescriptors = parseDexDefinedClassDescriptorsSafe(dexBytes);
    if (definedClassDescriptors.length > 0) {
      if (!composeDetected && hasDescriptorWithPrefix(definedClassDescriptors, ["Landroidx/compose/"])) {
        composeDetected = true;
      }

      if (!qihooDetected && hasDescriptorWithPrefix(definedClassDescriptors, ["Lcom/qihoo/util/", "Lcom/tianyu/util/"])) {
        qihooDetected = true;
      }

      if (!secneoDetected && hasDescriptorWithPrefix(definedClassDescriptors, ["Lcom/secneo/apkwrapper/"])) {
        secneoDetected = true;
      }

      if (!flutterInjectorDetected && hasDescriptorWithPrefix(definedClassDescriptors, ["Lio/flutter/FlutterInjector;"])) {
        flutterInjectorDetected = true;
      }
    }
  }

  return {
    kotlinDetected,
    composeDetected,
    nativeValidation: {
      qihooDetected,
      secneoDetected,
      flutterInjectorDetected,
    },
  };
}

function buildZipOnlyFeatureMarkers(zipEntries, composeDetected) {
  return {
    kotlinDetected: hasKotlinModule(zipEntries),
    composeDetected,
    nativeValidation: {
      qihooDetected: false,
      secneoDetected: false,
      flutterInjectorDetected: false,
    },
  };
}

async function readKotlinToolingMetadata(source) {
  const zipEntries = source.zipEntries;
  const entry = zipEntries.get("kotlin-tooling-metadata.json");
  if (!entry) {
    return {
      detected: false,
      kotlinVersion: null,
      gradleVersion: null,
    };
  }

  try {
    const bytes = await extractSourceEntry(source, entry);
    const metadata = JSON.parse(decodeUtf8(bytes));
    const projectTargets = Array.isArray(metadata?.projectTargets) ? metadata.projectTargets : [];
    const kotlinAndroidTarget = projectTargets.find(
      (target) =>
        target?.target === "org.jetbrains.kotlin.gradle.plugin.mpp.KotlinAndroidTarget",
    );
    const kotlinPluginDetected =
      metadata?.buildPlugin === "org.jetbrains.kotlin.gradle.plugin.KotlinAndroidPluginWrapper" ||
      Boolean(kotlinAndroidTarget);

    return {
      detected: Boolean(kotlinPluginDetected),
      kotlinVersion: kotlinPluginDetected ? normalizeVersionText(metadata?.buildPluginVersion) : null,
      gradleVersion:
        metadata?.buildSystem === "Gradle"
          ? normalizeVersionText(metadata?.buildSystemVersion)
          : null,
    };
  } catch {
    return {
      detected: true,
      kotlinVersion: null,
      gradleVersion: null,
    };
  }
}

async function readComposeMetadata(source) {
  const zipEntries = source.zipEntries;
  const detected = hasComposeMetaInfEntries(zipEntries);
  let composeVersion = null;

  for (const path of COMPOSE_VERSION_ENTRY_CANDIDATES) {
    const entry = zipEntries.get(path);
    if (!entry) {
      continue;
    }

    const bytes = await extractSourceEntry(source, entry);
    composeVersion = normalizeVersionText(decodeUtf8(bytes));
    if (composeVersion) {
      break;
    }
  }

  return {
    detected: detected || Boolean(composeVersion),
    composeVersion,
  };
}

async function readApkResources(source, options = {}) {
  const zipEntries = source.zipEntries;
  const resourcesEntry = zipEntries.get("resources.arsc");
  if (!resourcesEntry) {
    return null;
  }

  const maxEntryBytes = options.maxEntryBytes ?? Number.POSITIVE_INFINITY;
  if (entryExceedsSizeLimit(resourcesEntry, maxEntryBytes)) {
    return null;
  }

  try {
    const resourcesBytes = await extractSourceEntry(source, resourcesEntry);
    return parseResourcesTable(resourcesBytes);
  } catch {
    return null;
  }
}

async function extractSourceEntry(source, entry) {
  return source.extractEntry(entry);
}

function entryExceedsSizeLimit(entry, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return false;
  }

  return (entry.uncompressedSize || entry.compressedSize || 0) > maxBytes;
}

function resolveApplicationMetaData(items, resources) {
  return items.map((item) => resolveMetaDataItem(item, resources));
}

async function resolveApplicationIcon(source, manifest, resources) {
  if (!resources) {
    return null;
  }

  const resourceIds = [
    manifest.applicationIconRef,
    manifest.applicationRoundIconRef,
  ].filter((resourceId) => resourceId != null);

  for (const resourceId of resourceIds) {
    const candidates = resources.resolveFiles(resourceId);
    const icon = await readBestIconCandidate(source, resources, resourceId, candidates);
    if (icon) {
      return icon;
    }
  }

  return readBestIconCandidate(
    source,
    resources,
    null,
    collectFallbackIconCandidates(source.zipEntries),
  );
}

async function readBestIconCandidate(source, resources, resourceId, candidates, seen = new Set()) {
  if (seen.has(resourceId)) {
    return null;
  }
  seen.add(resourceId);

  const adaptiveIcon = await readAdaptiveIconFromXmlCandidates(source, resources, candidates, seen);
  if (adaptiveIcon) {
    return adaptiveIcon;
  }

  const candidate = selectBestIconCandidate(source.zipEntries, candidates);
  if (!candidate) {
    return readBestIconFromXmlCandidates(source, resources, candidates, seen);
  }

  try {
    const entry = source.zipEntries.get(candidate.path);
    const bytes = await extractSourceEntry(source, entry);
    if (bytes.byteLength > MAX_APP_ICON_BYTES) {
      return null;
    }

    const mimeType = getImageMimeType(candidate.path);
    return {
      resourceId: resourceId == null ? null : formatResourceReference(resourceId),
      path: candidate.path,
      mimeType,
      size: bytes.byteLength,
      dataUri: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    };
  } catch {
    return readBestIconFromXmlCandidates(source, resources, candidates, seen);
  }
}

async function readBestIconFromXmlCandidates(source, resources, candidates, seen) {
  const xmlCandidates = selectIconXmlCandidates(source.zipEntries, candidates);
  for (const candidate of xmlCandidates) {
    const entry = source.zipEntries.get(candidate.path);
    if (!entry) {
      continue;
    }

    try {
      const xmlBytes = await extractSourceEntry(source, entry);
      const adaptiveIcon = await renderAdaptiveIcon(xmlBytes, source, resources, candidate, seen);
      if (adaptiveIcon) {
        return adaptiveIcon;
      }

      const vectorIcon = await renderVectorDrawableIcon(xmlBytes, source, resources, candidate);
      if (vectorIcon) {
        return vectorIcon;
      }

      const referencedResourceIds = parseIconXmlReferencedResourceIds(xmlBytes);
      for (const resourceId of referencedResourceIds) {
        const icon = await readBestIconCandidate(
          source,
          resources,
          resourceId,
          resources.resolveFiles(resourceId),
          seen,
        );
        if (icon) {
          return icon;
        }
      }
    } catch {
      // Some icons are vectors or unsupported XML shapes; keep looking for bitmap fallbacks.
    }
  }

  return null;
}

async function readAdaptiveIconFromXmlCandidates(source, resources, candidates, seen) {
  const xmlCandidates = selectIconXmlCandidates(source.zipEntries, candidates);
  for (const candidate of xmlCandidates) {
    const entry = source.zipEntries.get(candidate.path);
    if (!entry) {
      continue;
    }

    try {
      const xmlBytes = await extractSourceEntry(source, entry);
      const adaptiveIcon = await renderAdaptiveIcon(xmlBytes, source, resources, candidate, seen);
      if (adaptiveIcon) {
        return adaptiveIcon;
      }
    } catch {
      // Unsupported XML should not block bitmap/vector fallbacks.
    }
  }

  return null;
}

function selectBestIconCandidate(zipEntries, candidates) {
  return (candidates || [])
    .filter((candidate) => {
      const entry = zipEntries.get(candidate.path);
      return (
        entry &&
        isImageResourcePath(candidate.path) &&
        (entry.uncompressedSize || entry.compressedSize || 0) <= MAX_APP_ICON_BYTES
      );
    })
    .sort((left, right) => getIconCandidateScore(right) - getIconCandidateScore(left))[0] || null;
}

function collectFallbackIconCandidates(zipEntries) {
  const candidates = [];
  for (const [path] of zipEntries.entries()) {
    if ((!isImageResourcePath(path) && !isXmlResourcePath(path)) || !isLikelyIconPath(path)) {
      continue;
    }

    candidates.push({
      path,
      typeName: path.includes("/mipmap") ? "mipmap" : "drawable",
      density: inferDensityFromPath(path),
      isDefaultConfig: path.includes("/mipmap/") || path.includes("/drawable/"),
      fallback: true,
    });
  }

  return candidates;
}

function selectIconXmlCandidates(zipEntries, candidates) {
  return (candidates || [])
    .filter((candidate) => {
      const entry = zipEntries.get(candidate.path);
      return (
        entry &&
        candidate.path.toLowerCase().endsWith(".xml") &&
        (entry.uncompressedSize || entry.compressedSize || 0) <= MAX_APP_ICON_BYTES
      );
    })
    .sort((left, right) => getIconCandidateScore(right) - getIconCandidateScore(left));
}

function parseIconXmlReferencedResourceIds(xmlBytes) {
  const bytes = toUint8Array(xmlBytes);
  if (readUint16(bytes, 0) !== RES_XML_TYPE) {
    return parseTextXmlReferencedResourceIds(decodeUtf8(bytes));
  }

  let stringPool = [];
  let resourceMap = [];
  const references = [];
  const fileSize = readUint32(bytes, 4);
  let offset = readUint16(bytes, 2);

  while (offset < fileSize) {
    const chunkType = readUint16(bytes, offset);
    const chunkSize = readUint32(bytes, offset + 4);
    if (chunkSize <= 0) {
      break;
    }

    if (chunkType === RES_STRING_POOL_TYPE) {
      stringPool = parseStringPool(bytes, offset);
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
      resourceMap = parseXmlResourceMap(bytes, offset);
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      const element = parseXmlStartElement(bytes, offset, stringPool, resourceMap);
      references.push(...collectIconElementReferenceItems(element));
    }

    offset += chunkSize;
  }

  return uniqueResourceIds(references.sort((left, right) => left.priority - right.priority).map((item) => item.resourceId));
}

function collectIconElementReferenceItems(element) {
  const references = [];
  const preferredNames = ["foreground", "background", "drawable", "icon", "monochrome"];
  const elementPriority = preferredNames.indexOf(element.name);

  for (const [name, attribute] of element.attributes.entries()) {
    if (
      attribute?.resourceId == null ||
      (attribute.dataType !== TYPE_REFERENCE && attribute.dataType !== TYPE_DYNAMIC_REFERENCE)
    ) {
      continue;
    }

    const attributePriority = preferredNames.indexOf(name);
    references.push({
      resourceId: attribute.resourceId,
      priority:
        (elementPriority >= 0 ? elementPriority : preferredNames.length) * 10 +
        (attributePriority >= 0 ? attributePriority : preferredNames.length),
    });
  }

  return references;
}

function parseTextXmlReferencedResourceIds(text) {
  const references = [];
  const matches = text.matchAll(/@0x([0-9a-f]{8})/giu);
  for (const match of matches) {
    references.push(Number.parseInt(match[1], 16) >>> 0);
  }
  return uniqueResourceIds(references);
}

function uniqueResourceIds(values) {
  return [...new Set(values.filter((value) => value != null))];
}

async function renderAdaptiveIcon(xmlBytes, source, resources, candidate, seen) {
  const elements = parseDrawableXmlElements(xmlBytes);
  if (!elements.some((element) => element.name === "adaptive-icon")) {
    return null;
  }

  const backgroundResourceId = getAdaptiveIconLayerResourceId(elements, "background");
  const foregroundResourceId = getAdaptiveIconLayerResourceId(elements, "foreground");
  const backgroundLayer =
    (await readAdaptiveIconLayer(source, resources, backgroundResourceId, new Set(seen))) ||
    readAdaptiveIconInlineColorLayer(elements, "background");
  const foregroundLayer =
    (await readAdaptiveIconLayer(source, resources, foregroundResourceId, new Set(seen))) ||
    readAdaptiveIconInlineColorLayer(elements, "foreground");

  if (!backgroundLayer && !foregroundLayer) {
    return null;
  }

  const svg = renderAdaptiveIconSvg(backgroundLayer, foregroundLayer);
  const bytes = new TextEncoder().encode(svg);
  if (bytes.byteLength > MAX_APP_ICON_BYTES) {
    return null;
  }

  return {
    resourceId: null,
    path: `${candidate.path}#adaptive`,
    mimeType: "image/svg+xml",
    size: bytes.byteLength,
    dataUri: `data:image/svg+xml;base64,${bytesToBase64(bytes)}`,
  };
}

function getAdaptiveIconLayerResourceId(elements, layerName) {
  const element = elements.find((item) => item.name === layerName);
  return getReferenceAttributeResourceId(element, "drawable");
}

function readAdaptiveIconInlineColorLayer(elements, layerName) {
  const element = elements.find((item) => item.name === layerName);
  const color =
    resolveInlineColorAttribute(element?.attributes.get("drawable")) ||
    resolveInlineColorAttribute(element?.attributes.get("color"));

  return color
    ? {
        kind: "color",
        color,
      }
    : null;
}

function getReferenceAttributeResourceId(element, preferredName) {
  if (!element) {
    return null;
  }

  const preferredAttribute = element.attributes.get(preferredName);
  if (isResourceReferenceAttribute(preferredAttribute)) {
    return preferredAttribute.resourceId;
  }

  for (const attribute of element.attributes.values()) {
    if (isResourceReferenceAttribute(attribute)) {
      return attribute.resourceId;
    }
  }

  return null;
}

function isResourceReferenceAttribute(attribute) {
  return (
    attribute?.resourceId != null &&
    (attribute.dataType === TYPE_REFERENCE || attribute.dataType === TYPE_DYNAMIC_REFERENCE)
  );
}

async function readAdaptiveIconLayer(source, resources, resourceId, seen) {
  if (resourceId == null || seen.has(resourceId)) {
    return null;
  }

  seen.add(resourceId);

  const color = resources.resolveColor(resourceId);
  if (color) {
    return {
      kind: "color",
      color,
    };
  }

  const candidates = resources.resolveFiles(resourceId);
  const xmlLayer = await readAdaptiveIconLayerFromXmlCandidates(source, resources, candidates, seen);
  if (xmlLayer) {
    return xmlLayer;
  }

  const imageCandidate = selectBestIconCandidate(source.zipEntries, candidates);
  if (!imageCandidate) {
    return null;
  }

  try {
    const entry = source.zipEntries.get(imageCandidate.path);
    const bytes = await extractSourceEntry(source, entry);
    if (bytes.byteLength > MAX_APP_ICON_BYTES) {
      return null;
    }

    const mimeType = getImageMimeType(imageCandidate.path);
    return {
      kind: "image",
      path: imageCandidate.path,
      mimeType,
      dataUri: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    };
  } catch {
    return null;
  }
}

async function readAdaptiveIconLayerFromXmlCandidates(source, resources, candidates, seen) {
  const xmlCandidates = selectIconXmlCandidates(source.zipEntries, candidates);
  for (const candidate of xmlCandidates) {
    const entry = source.zipEntries.get(candidate.path);
    if (!entry) {
      continue;
    }

    try {
      const xmlBytes = await extractSourceEntry(source, entry);
      const vectorLayer = await buildVectorDrawableSvgLayer(xmlBytes, source, resources, candidate);
      if (vectorLayer) {
        return {
          ...vectorLayer,
          path: candidate.path,
        };
      }

      const shapeLayer = buildShapeDrawableSvgLayer(xmlBytes, resources, candidate);
      if (shapeLayer) {
        return {
          ...shapeLayer,
          path: candidate.path,
        };
      }

      const referencedResourceIds = parseIconXmlReferencedResourceIds(xmlBytes);
      for (const referencedResourceId of referencedResourceIds) {
        const referencedLayer = await readAdaptiveIconLayer(
          source,
          resources,
          referencedResourceId,
          seen,
        );
        if (referencedLayer) {
          return referencedLayer;
        }
      }
    } catch {
      // Keep looking for other density/config variants.
    }
  }

  return null;
}

function renderAdaptiveIconSvg(backgroundLayer, foregroundLayer) {
  const size = ADAPTIVE_ICON_SIZE;
  const center = size / 2;
  const edgeRadius = center - ADAPTIVE_ICON_EDGE_INSET;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision">`,
    renderAdaptiveIconMaskDefs(center, edgeRadius),
    '<g mask="url(#lc-icon-mask)">',
    `<circle cx="${center}" cy="${center}" r="${center}" fill="#f8fafc"/>`,
    renderAdaptiveIconLayer(backgroundLayer, "background", size),
    renderAdaptiveIconLayer(foregroundLayer, "foreground", size),
    "</g>",
    "</svg>",
  ].join("");
}

function renderAdaptiveIconMaskDefs(center, edgeRadius) {
  const innerRadius = Math.max(0, edgeRadius - ADAPTIVE_ICON_EDGE_FEATHER);
  const gradientRadius = center;
  const innerOffset = innerRadius / gradientRadius;
  const outerOffset = edgeRadius / gradientRadius;
  return [
    "<defs>",
    `<radialGradient id="lc-icon-edge" gradientUnits="userSpaceOnUse" cx="${center}" cy="${center}" r="${gradientRadius}">`,
    `<stop offset="${formatSvgNumber(innerOffset)}" stop-color="#ffffff"/>`,
    `<stop offset="${formatSvgNumber(outerOffset)}" stop-color="#000000"/>`,
    "</radialGradient>",
    `<mask id="lc-icon-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${center * 2}" height="${center * 2}">`,
    `<rect x="0" y="0" width="${center * 2}" height="${center * 2}" fill="url(#lc-icon-edge)"/>`,
    "</mask>",
    "</defs>",
  ].join("");
}

function renderAdaptiveIconLayer(layer, role, size) {
  if (!layer) {
    return "";
  }

  if (layer.kind === "color") {
    const center = size / 2;
    return `<circle cx="${center}" cy="${center}" r="${center}" fill="${escapeXmlAttribute(layer.color)}"/>`;
  }

  if (layer.kind === "image") {
    const layerBounds = getAdaptiveIconLayerBounds(size);
    const fit = role === "background" ? "xMidYMid slice" : "xMidYMid meet";
    return [
      `<image href="${escapeXmlAttribute(layer.dataUri)}"`,
      ` x="${formatSvgNumber(layerBounds.offset)}" y="${formatSvgNumber(layerBounds.offset)}"`,
      ` width="${formatSvgNumber(layerBounds.size)}" height="${formatSvgNumber(layerBounds.size)}"`,
      ` preserveAspectRatio="${fit}"/>`,
    ].join("");
  }

  if (layer.kind === "vector") {
    const layerBounds = getAdaptiveIconLayerBounds(size);
    const scaleX = layerBounds.size / layer.viewportWidth;
    const scaleY = layerBounds.size / layer.viewportHeight;
    const transformParts = [
      formatSvgTranslate(layerBounds.offset, layerBounds.offset),
      `scale(${formatSvgNumber(scaleX)} ${formatSvgNumber(scaleY)})`,
    ];
    const transform = ` transform="${transformParts.join(" ")}"`;
    return `<g${transform}>${layer.content}</g>`;
  }

  if (layer.kind === "shape") {
    return [
      layer.defs,
      `<rect x="0" y="0" width="${size}" height="${size}" fill="${escapeXmlAttribute(layer.paint)}"/>`,
    ].join("");
  }

  return "";
}

function getAdaptiveIconLayerBounds(size) {
  const layerSize = size / ADAPTIVE_ICON_VIEW_PORT_SCALE;
  return {
    size: layerSize,
    offset: (size - layerSize) / 2,
  };
}

async function renderVectorDrawableIcon(xmlBytes, source, resources, candidate) {
  const layer = await buildVectorDrawableSvgLayer(xmlBytes, source, resources, candidate);
  if (!layer) {
    return null;
  }

  const svg = renderStandaloneVectorSvg(layer);
  const bytes = new TextEncoder().encode(svg);

  return {
    resourceId: null,
    path: candidate.path,
    mimeType: "image/svg+xml",
    size: bytes.byteLength,
    dataUri: `data:image/svg+xml;base64,${bytesToBase64(bytes)}`,
  };
}

async function buildVectorDrawableSvgLayer(xmlBytes, source, resources, candidate = null) {
  const elements = parseDrawableXmlElements(xmlBytes);
  const vectorElement = elements.find((element) => element.name === "vector");
  if (!vectorElement) {
    return null;
  }

  const viewportWidth = getNumericXmlAttribute(vectorElement, "viewportWidth");
  const viewportHeight = getNumericXmlAttribute(vectorElement, "viewportHeight");
  if (!viewportWidth || !viewportHeight) {
    return null;
  }

  const defs = [];
  const idPrefix = buildSvgIdPrefix(candidate?.path || "vector");
  const paths = [];
  for (const element of elements.filter((item) => item.name === "path")) {
    const path = await buildSvgPathFromVectorElement(element, source, resources, defs, idPrefix);
    if (path) {
      paths.push(path);
    }
  }

  if (paths.length === 0) {
    return null;
  }

  return {
    kind: "vector",
    viewportWidth,
    viewportHeight,
    content: `${defs.length > 0 ? `<defs>${defs.join("")}</defs>` : ""}${paths.join("")}`,
  };
}

function buildShapeDrawableSvgLayer(xmlBytes, resources, candidate = null) {
  const elements = parseDrawableXmlElements(xmlBytes);
  if (!elements.some((element) => element.name === "shape")) {
    return null;
  }

  const solidElement = elements.find((element) => element.name === "solid");
  const solidColor = resolveShapeColorAttribute(solidElement?.attributes.get("color"), resources);
  if (solidColor) {
    return {
      kind: "shape",
      defs: "",
      paint: solidColor,
    };
  }

  const gradientElement = elements.find((element) => element.name === "gradient");
  const gradient = buildShapeDrawableGradient(gradientElement, resources, candidate);
  if (gradient) {
    return {
      kind: "shape",
      defs: `<defs>${gradient.def}</defs>`,
      paint: `url(#${gradient.id})`,
    };
  }

  return null;
}

function buildShapeDrawableGradient(gradientElement, resources, candidate) {
  if (!gradientElement) {
    return null;
  }

  const stops = getShapeGradientStops(gradientElement, resources);
  if (stops.length < 2) {
    return null;
  }

  const id = `${buildSvgIdPrefix(candidate?.path || "shape")}-gradient`;
  const type = getXmlAttributeValue(gradientElement, "type");
  const def =
    type === "1"
      ? buildShapeRadialGradient(id, gradientElement, stops)
      : buildShapeLinearGradient(id, gradientElement, stops);

  return {
    id,
    def,
  };
}

function getShapeGradientStops(gradientElement, resources) {
  const startColor = resolveShapeColorAttribute(
    gradientElement.attributes.get("startColor"),
    resources,
  );
  const centerColor = resolveShapeColorAttribute(
    gradientElement.attributes.get("centerColor"),
    resources,
  );
  const endColor = resolveShapeColorAttribute(
    gradientElement.attributes.get("endColor"),
    resources,
  );
  const stops = [];

  if (startColor) {
    stops.push({ color: startColor, offset: 0 });
  }

  if (centerColor) {
    stops.push({ color: centerColor, offset: 0.5 });
  }

  if (endColor) {
    stops.push({ color: endColor, offset: 1 });
  }

  return stops;
}

function buildShapeLinearGradient(id, gradientElement, stops) {
  const angle = ((getNumericXmlAttribute(gradientElement, "angle") ?? 0) % 360 + 360) % 360;
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = -Math.sin(radians);
  const x1 = 50 - dx * 50;
  const y1 = 50 - dy * 50;
  const x2 = 50 + dx * 50;
  const y2 = 50 + dy * 50;

  return [
    `<linearGradient id="${escapeXmlAttribute(id)}"`,
    ` x1="${formatSvgNumber(x1)}%" y1="${formatSvgNumber(y1)}%"`,
    ` x2="${formatSvgNumber(x2)}%" y2="${formatSvgNumber(y2)}%">`,
    renderSvgGradientStops(stops),
    "</linearGradient>",
  ].join("");
}

function buildShapeRadialGradient(id, gradientElement, stops) {
  const centerX = getNumericXmlAttribute(gradientElement, "centerX");
  const centerY = getNumericXmlAttribute(gradientElement, "centerY");

  return [
    `<radialGradient id="${escapeXmlAttribute(id)}"`,
    ` cx="${formatShapeGradientPercent(centerX, 50)}%"`,
    ` cy="${formatShapeGradientPercent(centerY, 50)}%" r="50%">`,
    renderSvgGradientStops(stops),
    "</radialGradient>",
  ].join("");
}

function formatShapeGradientPercent(value, fallback) {
  const normalized = value == null ? fallback : value;
  return formatSvgNumber(Math.abs(normalized) <= 1 ? normalized * 100 : normalized);
}

function resolveShapeColorAttribute(attribute, resources) {
  return resolveInlineColorAttribute(attribute) || resolveVectorColor(attribute, resources);
}

function renderStandaloneVectorSvg(layer) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${escapeXmlAttribute(layer.viewportWidth)} ${escapeXmlAttribute(layer.viewportHeight)}">`,
    layer.content,
    "</svg>",
  ].join("");
}

function parseDrawableXmlElements(xmlBytes) {
  const bytes = toUint8Array(xmlBytes);
  if (readUint16(bytes, 0) !== RES_XML_TYPE) {
    return parseTextDrawableXmlElements(decodeUtf8(bytes));
  }

  let stringPool = [];
  let resourceMap = [];
  const elements = [];
  const groupStack = [];
  const fileSize = readUint32(bytes, 4);
  let offset = readUint16(bytes, 2);

  while (offset < fileSize) {
    const chunkType = readUint16(bytes, offset);
    const chunkSize = readUint32(bytes, offset + 4);
    if (chunkSize <= 0) {
      break;
    }

    if (chunkType === RES_STRING_POOL_TYPE) {
      stringPool = parseStringPool(bytes, offset);
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
      resourceMap = parseXmlResourceMap(bytes, offset);
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      const element = parseXmlStartElement(bytes, offset, stringPool, resourceMap);
      elements.push(withVectorGroupContext(element, groupStack));
      if (element.name === "group") {
        groupStack.push(element);
      }
    } else if (
      chunkType === RES_XML_END_ELEMENT_TYPE &&
      parseXmlEndElementName(bytes, offset, stringPool) === "group"
    ) {
      groupStack.pop();
    }

    offset += chunkSize;
  }

  return elements;
}

function parseTextDrawableXmlElements(text) {
  const elements = [];
  const groupStack = [];
  const tagMatches = text.matchAll(/<\s*(\/)?\s*([A-Za-z0-9_.:-]+)([^<>]*?)(\/?)\s*>/gsu);
  for (const match of tagMatches) {
    const name = match[2].split(":").at(-1);
    if (match[1]) {
      if (name === "group") {
        groupStack.pop();
      }
      continue;
    }

    const element = {
      name,
      attributes: parseTextXmlAttributes(match[3]),
    };
    elements.push(withVectorGroupContext(element, groupStack));

    if (name === "group" && !match[4]) {
      groupStack.push(element);
    }
  }
  return elements;
}

function parseTextXmlAttributes(attributeText) {
  const attributes = new Map();
  const attributeMatches = String(attributeText || "").matchAll(
    /([A-Za-z0-9_.:-]+)\s*=\s*(["'])(.*?)\2/gsu,
  );
  for (const attributeMatch of attributeMatches) {
    attributes.set(attributeMatch[1].split(":").at(-1), {
      dataType: TYPE_STRING,
      data: 0,
      resourceId: parseResourceReferenceText(attributeMatch[3]),
      displayValue: attributeMatch[3],
    });
  }
  return attributes;
}

function withVectorGroupContext(element, groupStack) {
  if (element.name !== "path" || groupStack.length === 0) {
    return element;
  }

  return {
    ...element,
    groups: [...groupStack],
  };
}

async function buildSvgPathFromVectorElement(element, source, resources, defs, idPrefix) {
  const pathData = normalizeText(getXmlAttributeValue(element, "pathData"));
  if (!pathData) {
    return null;
  }

  const fillColor =
    (await resolveVectorPaint(element.attributes.get("fillColor"), source, resources, defs, idPrefix)) ||
    "#000000";
  const fillAlpha = clampAlpha(getNumericXmlAttribute(element, "fillAlpha") ?? 1);
  const strokeColor = resolveVectorColor(element.attributes.get("strokeColor"), resources);
  const strokeWidth = getNumericXmlAttribute(element, "strokeWidth");
  const attrs = [
    `d="${escapeXmlAttribute(pathData)}"`,
    `fill="${escapeXmlAttribute(fillColor)}"`,
  ];

  if (fillAlpha < 1) {
    attrs.push(`fill-opacity="${fillAlpha}"`);
  }

  if (strokeColor && strokeWidth) {
    attrs.push(`stroke="${escapeXmlAttribute(strokeColor)}"`);
    attrs.push(`stroke-width="${escapeXmlAttribute(strokeWidth)}"`);
  }

  const path = `<path ${attrs.join(" ")}/>`;
  const transform = buildVectorElementTransform(element);
  return transform ? `<g transform="${escapeXmlAttribute(transform)}">${path}</g>` : path;
}

async function resolveVectorPaint(attribute, source, resources, defs, idPrefix) {
  const color = resolveVectorColor(attribute, resources);
  if (color || !source || !isResourceReferenceAttribute(attribute)) {
    return color;
  }

  return resolveVectorGradientPaint(attribute.resourceId, source, resources, defs, idPrefix);
}

async function resolveVectorGradientPaint(resourceId, source, resources, defs, idPrefix) {
  const candidates = resources.resolveFiles(resourceId);
  const xmlCandidates = selectDrawableXmlCandidates(source.zipEntries, candidates);
  for (const candidate of xmlCandidates) {
    const entry = source.zipEntries.get(candidate.path);
    if (!entry) {
      continue;
    }

    try {
      const xmlBytes = await extractSourceEntry(source, entry);
      const gradient = buildSvgGradientPaint(parseDrawableXmlElements(xmlBytes), defs, idPrefix);
      if (gradient) {
        return gradient;
      }
    } catch {
      // Keep looking for other density/config variants.
    }
  }

  return null;
}

function selectDrawableXmlCandidates(zipEntries, candidates) {
  return (candidates || [])
    .filter((candidate) => {
      const entry = zipEntries.get(candidate.path);
      return (
        entry &&
        candidate.path.toLowerCase().endsWith(".xml") &&
        (entry.uncompressedSize || entry.compressedSize || 0) <= MAX_APP_ICON_BYTES
      );
    })
    .sort((left, right) => Number(right.isDefaultConfig) - Number(left.isDefaultConfig));
}

function buildSvgGradientPaint(elements, defs, idPrefix) {
  const gradientElement = elements.find((element) => element.name === "gradient");
  if (!gradientElement) {
    return null;
  }

  const stops = getSvgGradientStops(elements, gradientElement);
  if (stops.length < 2) {
    return null;
  }

  const id = `${idPrefix}-gradient-${defs.length}`;
  const type = getXmlAttributeValue(gradientElement, "type");
  const gradient =
    type === "1"
      ? buildSvgRadialGradient(id, gradientElement, stops)
      : buildSvgLinearGradient(id, gradientElement, stops);
  defs.push(gradient);
  return `url(#${id})`;
}

function getSvgGradientStops(elements, gradientElement) {
  const itemStops = elements
    .filter((element) => element.name === "item")
    .map((element) => ({
      color: resolveInlineColorAttribute(element.attributes.get("color")),
      offset: getNumericXmlAttribute(element, "offset"),
    }))
    .filter((stop) => stop.color && stop.offset != null);

  if (itemStops.length > 0) {
    return itemStops;
  }

  const stops = [];
  const startColor = resolveInlineColorAttribute(gradientElement.attributes.get("startColor"));
  const centerColor = resolveInlineColorAttribute(gradientElement.attributes.get("centerColor"));
  const endColor = resolveInlineColorAttribute(gradientElement.attributes.get("endColor"));
  if (startColor) {
    stops.push({ color: startColor, offset: 0 });
  }
  if (centerColor) {
    stops.push({ color: centerColor, offset: 0.5 });
  }
  if (endColor) {
    stops.push({ color: endColor, offset: 1 });
  }

  return stops;
}

function buildSvgLinearGradient(id, gradientElement, stops) {
  const x1 = getNumericXmlAttribute(gradientElement, "startX") ?? 0;
  const y1 = getNumericXmlAttribute(gradientElement, "startY") ?? 0;
  const x2 = getNumericXmlAttribute(gradientElement, "endX") ?? 0;
  const y2 = getNumericXmlAttribute(gradientElement, "endY") ?? 0;
  return [
    `<linearGradient id="${escapeXmlAttribute(id)}" gradientUnits="userSpaceOnUse"`,
    ` x1="${formatSvgNumber(x1)}" y1="${formatSvgNumber(y1)}"`,
    ` x2="${formatSvgNumber(x2)}" y2="${formatSvgNumber(y2)}">`,
    renderSvgGradientStops(stops),
    "</linearGradient>",
  ].join("");
}

function buildSvgRadialGradient(id, gradientElement, stops) {
  const cx = getNumericXmlAttribute(gradientElement, "centerX") ?? 0;
  const cy = getNumericXmlAttribute(gradientElement, "centerY") ?? 0;
  const radius = getNumericXmlAttribute(gradientElement, "gradientRadius") ?? 0;
  return [
    `<radialGradient id="${escapeXmlAttribute(id)}" gradientUnits="userSpaceOnUse"`,
    ` cx="${formatSvgNumber(cx)}" cy="${formatSvgNumber(cy)}" r="${formatSvgNumber(radius)}">`,
    renderSvgGradientStops(stops),
    "</radialGradient>",
  ].join("");
}

function renderSvgGradientStops(stops) {
  return stops
    .map((stop) => `<stop offset="${formatSvgNumber(stop.offset)}"${formatSvgStopColor(stop.color)}/>`)
    .join("");
}

function formatSvgStopColor(color) {
  const rgba = String(color || "").match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/iu);
  if (rgba) {
    return [
      ` stop-color="#${toHex2(Number(rgba[1]))}${toHex2(Number(rgba[2]))}${toHex2(Number(rgba[3]))}"`,
      ` stop-opacity="${escapeXmlAttribute(rgba[4])}"`,
    ].join("");
  }

  return ` stop-color="${escapeXmlAttribute(color)}"`;
}

function resolveInlineColorAttribute(attribute) {
  if (!attribute) {
    return null;
  }

  if (attribute.dataType >= TYPE_FIRST_COLOR_INT && attribute.dataType <= TYPE_LAST_COLOR_INT) {
    return formatCssColor(attribute.data);
  }

  return normalizeColorText(attribute.displayValue);
}

function buildVectorElementTransform(element) {
  const transforms = (element.groups || []).map(buildVectorGroupTransform).filter(Boolean);
  return transforms.join(" ");
}

function buildVectorGroupTransform(group) {
  const translateX = getNumericXmlAttribute(group, "translateX") ?? 0;
  const translateY = getNumericXmlAttribute(group, "translateY") ?? 0;
  const pivotX = getNumericXmlAttribute(group, "pivotX") ?? 0;
  const pivotY = getNumericXmlAttribute(group, "pivotY") ?? 0;
  const scaleX = getNumericXmlAttribute(group, "scaleX") ?? 1;
  const scaleY = getNumericXmlAttribute(group, "scaleY") ?? 1;
  const rotation = getNumericXmlAttribute(group, "rotation") ?? 0;

  const hasTranslate = !isCloseTo(translateX, 0) || !isCloseTo(translateY, 0);
  const hasScale = !isCloseTo(scaleX, 1) || !isCloseTo(scaleY, 1);
  const hasRotation = !isCloseTo(rotation, 0);
  if (!hasTranslate && !hasScale && !hasRotation) {
    return "";
  }

  const usesPivot = hasScale || hasRotation;
  const initialTranslateX = translateX + (usesPivot ? pivotX : 0);
  const initialTranslateY = translateY + (usesPivot ? pivotY : 0);
  const transforms = [];

  if (!isCloseTo(initialTranslateX, 0) || !isCloseTo(initialTranslateY, 0)) {
    transforms.push(formatSvgTranslate(initialTranslateX, initialTranslateY));
  }

  if (hasRotation) {
    transforms.push(`rotate(${formatSvgNumber(rotation)})`);
  }

  if (hasScale) {
    transforms.push(`scale(${formatSvgNumber(scaleX)} ${formatSvgNumber(scaleY)})`);
  }

  if (usesPivot && (!isCloseTo(pivotX, 0) || !isCloseTo(pivotY, 0))) {
    transforms.push(formatSvgTranslate(-pivotX, -pivotY));
  }

  return transforms.join(" ");
}

function formatSvgTranslate(x, y) {
  return `translate(${formatSvgNumber(x)} ${formatSvgNumber(y)})`;
}

function buildSvgIdPrefix(value) {
  const normalized = String(value || "vector")
    .replaceAll(/[^a-z0-9_-]+/giu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return `lc-${normalized || "vector"}`;
}

function isCloseTo(value, expected) {
  return Math.abs(value - expected) < 0.000001;
}

function getXmlAttributeValue(element, name) {
  return element.attributes.get(name)?.displayValue || null;
}

function getNumericXmlAttribute(element, name) {
  const attribute = element.attributes.get(name);
  if (!attribute) {
    return null;
  }

  if (attribute.dataType === TYPE_FLOAT) {
    return readFloat32FromUint32(attribute.data);
  }

  if (attribute.dataType === TYPE_DIMENSION) {
    return complexToFloat(attribute.data);
  }

  const normalized = normalizeText(attribute.displayValue)?.replace(/[a-z%]+$/iu, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveVectorColor(attribute, resources) {
  if (!attribute) {
    return null;
  }

  if (attribute.dataType >= TYPE_FIRST_COLOR_INT && attribute.dataType <= TYPE_LAST_COLOR_INT) {
    return formatCssColor(attribute.data);
  }

  if (
    attribute.resourceId != null &&
    (attribute.dataType === TYPE_REFERENCE || attribute.dataType === TYPE_DYNAMIC_REFERENCE)
  ) {
    return resources.resolveColor(attribute.resourceId) || null;
  }

  return normalizeColorText(attribute.displayValue);
}

function normalizeColorText(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (/^#[0-9a-f]{3}$/iu.test(normalized) || /^#[0-9a-f]{6}$/iu.test(normalized)) {
    return normalized;
  }

  const argbMatch = normalized.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/iu);
  if (argbMatch) {
    return formatAndroidHexColor(argbMatch[1]);
  }

  const hexMatch = normalized.match(/^0x([0-9a-f]{6,8})$/iu);
  if (hexMatch) {
    return formatCssColor(Number.parseInt(hexMatch[1], 16) >>> 0);
  }

  return null;
}

function formatAndroidHexColor(hex) {
  if (hex.length === 4) {
    const alpha = Number.parseInt(hex[0] + hex[0], 16);
    const red = Number.parseInt(hex[1] + hex[1], 16);
    const green = Number.parseInt(hex[2] + hex[2], 16);
    const blue = Number.parseInt(hex[3] + hex[3], 16);
    return formatCssColor(((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0);
  }

  return formatCssColor(Number.parseInt(hex, 16) >>> 0);
}

function parseResourceReferenceText(value) {
  const match = String(value || "").match(/^@0x([0-9a-f]{8})$/iu);
  return match ? Number.parseInt(match[1], 16) >>> 0 : null;
}

function clampAlpha(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function readFloat32FromUint32(value) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value, true);
  return view.getFloat32(0, true);
}

function complexToFloat(value) {
  const mantissa = (value & 0x00ffffff) << 8 >> 8;
  const radix = (value >> 4) & 0x03;
  const multipliers = [1 / (1 << 23), 1 / (1 << 15), 1 / (1 << 7), 1];
  return mantissa * multipliers[radix];
}

function escapeXmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatSvgNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return Number(value.toFixed(6)).toString();
}

function getIconCandidateScore(candidate) {
  const path = candidate.path.toLowerCase();
  const formatScore = path.endsWith(".png") ? 3000 : path.endsWith(".webp") ? 2500 : 2000;
  const density = candidate.density || 0;
  const densityScore = density === 0xfffe ? 1 : Math.min(density, 1000);
  return formatScore + densityScore + getIconNameScore(path);
}

function isImageResourcePath(path) {
  return /\.(png|webp|jpe?g)$/iu.test(path);
}

function isXmlResourcePath(path) {
  return /\.xml$/iu.test(path);
}

function isLikelyIconPath(path) {
  const normalized = path.toLowerCase();
  if (!normalized.startsWith("res/mipmap") && !normalized.startsWith("res/drawable")) {
    return false;
  }

  if (/(notification|notify|status|splash|banner|foreground|background|monochrome)/u.test(normalized)) {
    return false;
  }

  return /(ic_launcher|launcher|app_icon|icon|logo)/u.test(normalized);
}

function getIconNameScore(path) {
  let score = 0;
  if (path.includes("ic_launcher")) {
    score += 12000;
  } else if (path.includes("launcher")) {
    score += 10000;
  } else if (path.includes("app_icon")) {
    score += 9000;
  } else if (path.includes("icon")) {
    score += 7000;
  } else if (path.includes("logo")) {
    score += 5000;
  }

  if (path.includes("/mipmap")) {
    score += 1000;
  }

  return score;
}

function inferDensityFromPath(path) {
  const normalized = path.toLowerCase();
  if (normalized.includes("-xxxhdpi")) {
    return 640;
  }
  if (normalized.includes("-xxhdpi")) {
    return 480;
  }
  if (normalized.includes("-xhdpi")) {
    return 320;
  }
  if (normalized.includes("-hdpi")) {
    return 240;
  }
  if (normalized.includes("-mdpi")) {
    return 160;
  }
  if (normalized.includes("-ldpi")) {
    return 120;
  }
  if (normalized.includes("-nodpi")) {
    return 0xfffe;
  }
  return 0;
}

function getImageMimeType(path) {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "image/png";
}

function bytesToBase64(bytes) {
  if (typeof btoa !== "function") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function resolveMetaDataItem(item, resources) {
  if (!item?.hasResourceReference || item.resourceId == null || !resources) {
    return item;
  }

  const resolvedValue = normalizeText(resources.resolveString(item.resourceId));
  if (!resolvedValue) {
    return item;
  }

  return {
    ...item,
    value: resolvedValue,
    resolvedFromResource: true,
  };
}

function hasComposeMetaInfEntries(zipEntries) {
  for (const path of zipEntries.keys()) {
    if (!path.startsWith("META-INF/") || !path.endsWith(".version")) {
      continue;
    }

    const fileName = path.slice("META-INF/".length);
    if (fileName.startsWith("androidx.compose.ui") || fileName.startsWith("androidx.compose.material")) {
      return true;
    }
  }

  return false;
}

function hasKotlinModule(zipEntries) {
  for (const path of zipEntries.keys()) {
    if (path.startsWith("META-INF/") && path.endsWith(".kotlin_module")) {
      return true;
    }
  }

  return false;
}

function containsAnyAscii(bytes, needles) {
  return needles.some((needle) => containsAscii(bytes, needle));
}

function containsAscii(bytes, needle) {
  const encodedNeedle = asciiBytes(needle);
  if (encodedNeedle.length === 0 || encodedNeedle.length > bytes.length) {
    return false;
  }

  const lastStart = bytes.length - encodedNeedle.length;
  for (let start = 0; start <= lastStart; start += 1) {
    if (bytes[start] !== encodedNeedle[0]) {
      continue;
    }

    let matched = true;
    for (let index = 1; index < encodedNeedle.length; index += 1) {
      if (bytes[start + index] !== encodedNeedle[index]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return true;
    }
  }

  return false;
}

function dexDefinesClassWithPrefix(bytes, prefixes) {
  try {
    return hasDescriptorWithPrefix(parseDexDefinedClassDescriptors(bytes), prefixes);
  } catch {
    return false;
  }
}

function parseDexDefinedClassDescriptorsSafe(bytes) {
  try {
    return parseDexDefinedClassDescriptors(bytes);
  } catch {
    return [];
  }
}

function parseDexDefinedClassDescriptors(bytes) {
  const strings = parseDexStrings(bytes);
  if (strings.length === 0) {
    return [];
  }

  const typeDescriptors = parseDexTypeDescriptors(bytes, strings);
  const classDefsSize = readUint32(bytes, 0x60);
  const classDefsOffset = readUint32(bytes, 0x64);
  const descriptors = [];

  for (let index = 0; index < classDefsSize; index += 1) {
    const classDefOffset = classDefsOffset + index * 32;
    const classIndex = readUint32(bytes, classDefOffset);
    const descriptor = typeDescriptors[classIndex];
    if (descriptor) {
      descriptors.push(descriptor);
    }
  }

  return descriptors;
}

function hasDescriptorWithPrefix(descriptors, prefixes) {
  return descriptors.some((descriptor) => prefixes.some((prefix) => descriptor.startsWith(prefix)));
}

function parseDexStrings(bytes) {
  const size = readUint32(bytes, 0x38);
  const offset = readUint32(bytes, 0x3c);
  if (!size || !offset) {
    return [];
  }

  const strings = new Array(size);
  for (let index = 0; index < size; index += 1) {
    const stringDataOffset = readUint32(bytes, offset + index * 4);
    strings[index] = readDexString(bytes, stringDataOffset);
  }

  return strings;
}

function parseDexTypeDescriptors(bytes, strings) {
  const size = readUint32(bytes, 0x40);
  const offset = readUint32(bytes, 0x44);
  if (!size || !offset) {
    return [];
  }

  const descriptors = new Array(size);
  for (let index = 0; index < size; index += 1) {
    descriptors[index] = strings[readUint32(bytes, offset + index * 4)] || null;
  }

  return descriptors;
}

function readDexString(bytes, offset) {
  if (!offset) {
    return "";
  }

  const lengthInfo = readUleb128(bytes, offset);
  let end = lengthInfo.nextOffset;
  while (end < bytes.length && bytes[end] !== 0) {
    end += 1;
  }

  return decodeUtf8(bytes.subarray(lengthInfo.nextOffset, end));
}

function readUleb128(bytes, offset) {
  let result = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    result |= (byte & 0x7f) << shift;
    cursor += 1;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }

  return {
    value: result >>> 0,
    nextOffset: cursor,
  };
}

function normalizeVersionText(value) {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(/\r?\n/gu, "").trim() : null;
}


function asciiBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0x7f;
  }
  return bytes;
}

function parseProperties(text) {
  const result = {};

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }

    const separatorIndex = line.search(/[:=]/u);
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key) {
      result[key] = value;
    }
  }

  return result;
}

function collectNativeLibraries(zipEntries) {
  const libraries = [];

  for (const [path, entry] of zipEntries.entries()) {
    if (!path.startsWith("lib/") || !path.endsWith(".so")) {
      continue;
    }

    const segments = path.split("/");
    if (segments.length < 3) {
      continue;
    }

    libraries.push({
      abi: segments[1],
      name: segments[segments.length - 1],
      path,
      size: entry.uncompressedSize || entry.compressedSize || 0,
    });
  }

  libraries.sort(compareNativeLibraries);

  return libraries;
}

function compareNativeLibraries(left, right) {
  if (left.abi !== right.abi) {
    return left.abi.localeCompare(right.abi);
  }

  if (left.name !== right.name) {
    return left.name.localeCompare(right.name);
  }

  const leftSource = left.sourceEntry || "";
  const rightSource = right.sourceEntry || "";
  if (leftSource !== rightSource) {
    return leftSource.localeCompare(rightSource);
  }

  return left.path.localeCompare(right.path);
}

function parseZipEntries(bytes) {
  const entries = new Map();
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const totalEntries = readUint16(bytes, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(bytes, eocdOffset + 16);

  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUint32(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("APK ZIP 中央目录损坏");
    }

    const flags = readUint16(bytes, offset + 8);
    const compressionMethod = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const fileNameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localHeaderOffset = readUint32(bytes, offset + 42);

    const nameStart = offset + 46;
    const fileName = decodeUtf8(bytes.subarray(nameStart, nameStart + fileNameLength));

    entries.set(fileName, {
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(bytes) {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(bytes, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("APK ZIP 结束记录不存在");
}

async function extractZipEntry(zipBytes, entry) {
  if ((entry.flags & 0x0001) !== 0) {
    throw new Error("暂不支持解析已加密的 ZIP 条目");
  }

  const headerOffset = entry.localHeaderOffset;
  if (readUint32(zipBytes, headerOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error("APK ZIP 本地文件头损坏");
  }

  const fileNameLength = readUint16(zipBytes, headerOffset + 26);
  const extraLength = readUint16(zipBytes, headerOffset + 28);
  const dataOffset = headerOffset + 30 + fileNameLength + extraLength;
  const compressedData = zipBytes.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compressionMethod === ZIP_COMPRESSION_STORE) {
    return new Uint8Array(compressedData);
  }

  if (entry.compressionMethod === ZIP_COMPRESSION_DEFLATE) {
    return inflateRaw(compressedData);
  }

  throw new Error(`不支持的 ZIP 压缩方式: ${entry.compressionMethod}`);
}

async function inflateRaw(bytes) {
  if (bytes.byteLength === 0) {
    return new Uint8Array();
  }

  const decompressed = new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
  );
  const buffer = await decompressed.arrayBuffer();
  return new Uint8Array(buffer);
}

function parseAndroidManifest(manifestBuffer) {
  const bytes = toUint8Array(manifestBuffer);
  if (readUint16(bytes, 0) !== RES_XML_TYPE) {
    throw new Error("AndroidManifest.xml 不是有效的二进制 XML");
  }

  let stringPool = [];
  let resourceMap = [];
  const permissions = [];
  const seenPermissions = new Set();
  const stack = [];

  const manifest = {
    packageName: null,
    versionName: null,
    versionCode: null,
    minSdk: null,
    targetSdk: null,
    compileSdk: null,
    applicationLabel: null,
    applicationLabelRef: null,
    applicationIconRef: null,
    applicationRoundIconRef: null,
    components: {
      activities: [],
      services: [],
      receivers: [],
      providers: [],
    },
    metaData: {
      application: [],
      components: [],
    },
  };

  const fileSize = readUint32(bytes, 4);
  let offset = readUint16(bytes, 2);
  while (offset < fileSize) {
    const chunkType = readUint16(bytes, offset);
    const chunkSize = readUint32(bytes, offset + 4);

    if (chunkSize <= 0) {
      throw new Error("AndroidManifest.xml chunk 尺寸无效");
    }

    if (chunkType === RES_STRING_POOL_TYPE) {
      stringPool = parseStringPool(bytes, offset);
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
      resourceMap = parseXmlResourceMap(bytes, offset);
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      const element = parseXmlStartElement(bytes, offset, stringPool, resourceMap);
      handleManifestStartElement(manifest, element, stack, permissions, seenPermissions);
      stack.push(buildManifestStackNode(manifest, element, stack.at(-1)));
    } else if (chunkType === RES_XML_END_ELEMENT_TYPE) {
      stack.pop();
    }

    offset += chunkSize;
  }

  return {
    ...manifest,
    permissions,
  };
}

function handleManifestStartElement(manifest, element, stack, permissions, seenPermissions) {
  const parent = stack.at(-1) || null;
  const getAttribute = (name) => element.attributes.get(name) || null;

  if (element.name === "manifest") {
    manifest.packageName = normalizeText(getAttribute("package")?.displayValue);
    manifest.versionName = normalizeText(getAttribute("versionName")?.displayValue);
    manifest.compileSdk =
      normalizeText(getAttribute("compileSdkVersion")?.displayValue) ||
      normalizeText(getAttribute("platformBuildVersionCode")?.displayValue);

    const versionCodeLow = toInteger(getAttribute("versionCode"));
    const versionCodeHigh = toInteger(getAttribute("versionCodeMajor"));
    if (versionCodeLow != null || versionCodeHigh != null) {
      manifest.versionCode = combineVersionCode(versionCodeLow, versionCodeHigh);
    } else {
      manifest.versionCode = normalizeText(getAttribute("versionCode")?.displayValue);
    }
    return;
  }

  if (element.name === "uses-sdk") {
    manifest.minSdk = normalizeText(getAttribute("minSdkVersion")?.displayValue);
    manifest.targetSdk = normalizeText(getAttribute("targetSdkVersion")?.displayValue);
    return;
  }

  if (element.name === "application") {
    const labelAttribute = getAttribute("label");
    if (labelAttribute) {
      if (
        labelAttribute.dataType === TYPE_REFERENCE ||
        labelAttribute.dataType === TYPE_DYNAMIC_REFERENCE
      ) {
        manifest.applicationLabelRef = labelAttribute.resourceId;
      } else {
        manifest.applicationLabel = normalizeText(labelAttribute.displayValue);
      }
    }

    const iconAttribute = getAttribute("icon");
    if (
      iconAttribute &&
      (iconAttribute.dataType === TYPE_REFERENCE || iconAttribute.dataType === TYPE_DYNAMIC_REFERENCE)
    ) {
      manifest.applicationIconRef = iconAttribute.resourceId;
    }

    const roundIconAttribute = getAttribute("roundIcon");
    if (
      roundIconAttribute &&
      (roundIconAttribute.dataType === TYPE_REFERENCE || roundIconAttribute.dataType === TYPE_DYNAMIC_REFERENCE)
    ) {
      manifest.applicationRoundIconRef = roundIconAttribute.resourceId;
    }

    return;
  }

  if (element.name.startsWith("uses-permission")) {
    const permission = normalizeText(getAttribute("name")?.displayValue);
    if (permission && !seenPermissions.has(permission)) {
      seenPermissions.add(permission);
      permissions.push(permission);
    }
    return;
  }

  if (isManifestComponentElement(element.name) && parent?.name === "application") {
    createManifestComponent(manifest, element);
    return;
  }

  if (element.name === "action" && parent?.kind === "intent-filter" && parent.ref?.component) {
    const action = normalizeText(getAttribute("name")?.displayValue);
    if (action && !parent.ref.component.actions.includes(action)) {
      parent.ref.component.actions.push(action);
    }
    return;
  }

  if (element.name === "meta-data") {
    collectManifestMetaData(manifest, element, parent);
  }
}

function buildManifestStackNode(manifest, element, parent) {
  const node = {
    name: element.name,
    kind: "element",
    ref: null,
  };

  if (element.name === "application") {
    node.kind = "application";
    return node;
  }

  if (isManifestComponentElement(element.name) && parent?.name === "application") {
    node.kind = "component";
    node.ref = getLatestComponentForElement(manifest, element.name);
    return node;
  }

  if (element.name === "intent-filter" && parent?.kind === "component" && parent.ref) {
    node.kind = "intent-filter";
    node.ref = {
      component: parent.ref,
    };
  }

  return node;
}

function isManifestComponentElement(name) {
  return (
    name === "activity" ||
    name === "activity-alias" ||
    name === "service" ||
    name === "receiver" ||
    name === "provider"
  );
}

function createManifestComponent(manifest, element) {
  const component = buildComponentInfo(manifest.packageName, element);

  if (component.section === "activities") {
    manifest.components.activities.push(component);
  } else if (component.section === "services") {
    manifest.components.services.push(component);
  } else if (component.section === "receivers") {
    manifest.components.receivers.push(component);
  } else if (component.section === "providers") {
    manifest.components.providers.push(component);
  }
}

function getLatestComponentForElement(manifest, elementName) {
  if (elementName === "activity" || elementName === "activity-alias") {
    return manifest.components.activities.at(-1) || null;
  }

  if (elementName === "service") {
    return manifest.components.services.at(-1) || null;
  }

  if (elementName === "receiver") {
    return manifest.components.receivers.at(-1) || null;
  }

  if (elementName === "provider") {
    return manifest.components.providers.at(-1) || null;
  }

  return null;
}

function buildComponentInfo(packageName, element) {
  const getAttribute = (name) => element.attributes.get(name) || null;
  const labelAttribute = getAttribute("label");
  let label = normalizeText(labelAttribute?.displayValue);
  let labelRef = null;

  if (
    labelAttribute &&
    (labelAttribute.dataType === TYPE_REFERENCE || labelAttribute.dataType === TYPE_DYNAMIC_REFERENCE)
  ) {
    labelRef = labelAttribute.resourceId;
    label = label || formatResourceReference(labelRef);
  }

  const componentName = normalizeComponentName(
    packageName,
    normalizeText(getAttribute("name")?.displayValue),
  );

  return {
    type: element.name,
    section: mapComponentSection(element.name),
    name: componentName || "未知",
    shortName: shortenComponentName(packageName, componentName),
    exported: normalizeBoolean(getAttribute("exported")),
    enabled: normalizeBoolean(getAttribute("enabled")),
    permission: normalizeText(getAttribute("permission")?.displayValue),
    process: normalizeText(getAttribute("process")?.displayValue),
    authorities: normalizeText(getAttribute("authorities")?.displayValue),
    targetActivity: normalizeComponentName(
      packageName,
      normalizeText(getAttribute("targetActivity")?.displayValue),
    ),
    label,
    labelRef,
    actions: [],
    metaData: [],
  };
}

function collectManifestMetaData(manifest, element, parent) {
  const metaData = buildMetaDataInfo(element);
  if (!metaData) {
    return;
  }

  if (parent?.kind === "application" || parent?.name === "application") {
    manifest.metaData.application.push(metaData);
  }
}

function buildMetaDataInfo(element) {
  const getAttribute = (name) => element.attributes.get(name) || null;
  const name = normalizeText(getAttribute("name")?.displayValue);
  if (!name) {
    return null;
  }

  const valueAttribute = getAttribute("value");
  const resourceAttribute = getAttribute("resource");
  const rawAttribute = resourceAttribute || valueAttribute;
  const value = normalizeText(rawAttribute?.displayValue) || null;

  return {
    name,
    value,
    resourceId: rawAttribute?.resourceId ?? null,
    hasResourceReference: Boolean(
      rawAttribute &&
        (rawAttribute.dataType === TYPE_REFERENCE || rawAttribute.dataType === TYPE_DYNAMIC_REFERENCE),
    ),
    resolvedFromResource: false,
  };
}

function mapComponentSection(type) {
  if (type === "service") {
    return "services";
  }

  if (type === "receiver") {
    return "receivers";
  }

  if (type === "provider") {
    return "providers";
  }

  return "activities";
}

function normalizeComponentName(packageName, componentName) {
  const normalized = normalizeText(componentName);
  if (!normalized) {
    return null;
  }

  if (!packageName) {
    return normalized;
  }

  if (normalized.startsWith(".")) {
    return `${packageName}${normalized}`;
  }

  if (!normalized.includes(".")) {
    return `${packageName}.${normalized}`;
  }

  return normalized;
}

function shortenComponentName(packageName, componentName) {
  if (!packageName || !componentName) {
    return componentName;
  }

  return componentName.startsWith(`${packageName}.`)
    ? componentName.slice(packageName.length + 1)
    : componentName;
}

function normalizeBoolean(attribute) {
  if (!attribute) {
    return null;
  }

  if (attribute.dataType === TYPE_INT_BOOLEAN) {
    return attribute.data !== 0;
  }

  const normalized = normalizeText(attribute.displayValue);
  if (normalized == null) {
    return null;
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}

function parseXmlStartElement(bytes, offset, stringPool, resourceMap = []) {
  const nameIndex = readUint32(bytes, offset + 20);
  const attributeStart = readUint16(bytes, offset + 24);
  const attributeSize = readUint16(bytes, offset + 26);
  const attributeCount = readUint16(bytes, offset + 28);

  const attributes = new Map();
  let attributeOffset = offset + 16 + attributeStart;
  for (let index = 0; index < attributeCount; index += 1) {
    const attributeNameIndex = readUint32(bytes, attributeOffset + 4);
    const resourceId = resourceMap[attributeNameIndex] || null;
    const name = getString(stringPool, attributeNameIndex) || getAndroidAttributeName(resourceId);
    const rawValueIndex = readUint32(bytes, attributeOffset + 8);
    const dataType = bytes[attributeOffset + 15];
    const data = readUint32(bytes, attributeOffset + 16);
    const rawValue = rawValueIndex === AXML_NO_INDEX ? null : getString(stringPool, rawValueIndex);

    const value = {
      dataType,
      data,
      resourceId:
        dataType === TYPE_REFERENCE || dataType === TYPE_DYNAMIC_REFERENCE ? data >>> 0 : null,
      displayValue: coerceTypedValue(rawValue, dataType, data, stringPool),
      attributeResourceId: resourceId,
    };

    if (name) {
      attributes.set(name, value);
    }

    attributeOffset += attributeSize;
  }

  return {
    name: getString(stringPool, nameIndex),
    attributes,
  };
}

function parseXmlEndElementName(bytes, offset, stringPool) {
  return getString(stringPool, readUint32(bytes, offset + 20));
}

function coerceTypedValue(rawValue, dataType, data, stringPool) {
  if (rawValue != null) {
    return rawValue;
  }

  if (dataType === TYPE_STRING) {
    return getString(stringPool, data);
  }

  if (dataType === TYPE_FLOAT) {
    return String(readFloat32FromUint32(data));
  }

  if (dataType === TYPE_DIMENSION) {
    return String(complexToFloat(data));
  }

  if (dataType === TYPE_REFERENCE || dataType === TYPE_DYNAMIC_REFERENCE) {
    return formatResourceReference(data);
  }

  if (dataType === TYPE_INT_DEC) {
    return String(toSigned32(data));
  }

  if (dataType === TYPE_INT_HEX) {
    return `0x${(data >>> 0).toString(16)}`;
  }

  if (dataType === TYPE_INT_BOOLEAN) {
    return data !== 0 ? "true" : "false";
  }

  if (dataType >= TYPE_FIRST_COLOR_INT && dataType <= TYPE_LAST_COLOR_INT) {
    return formatCssColor(data);
  }

  return `0x${(data >>> 0).toString(16)}`;
}

function parseResourcesTable(resourcesBuffer) {
  const bytes = toUint8Array(resourcesBuffer);
  if (readUint16(bytes, 0) !== RES_TABLE_TYPE) {
    throw new Error("resources.arsc 不是有效的资源表");
  }

  const globalStrings = [];
  const packages = new Map();
  const tableSize = readUint32(bytes, 4);

  let offset = readUint16(bytes, 2);
  while (offset < tableSize) {
    const chunkType = readUint16(bytes, offset);
    const chunkSize = readUint32(bytes, offset + 4);

    if (chunkSize <= 0) {
      throw new Error("resources.arsc chunk 尺寸无效");
    }

    if (chunkType === RES_STRING_POOL_TYPE && globalStrings.length === 0) {
      globalStrings.push(...parseStringPool(bytes, offset));
    } else if (chunkType === RES_TABLE_PACKAGE_TYPE) {
      const packageInfo = parseResourcePackage(bytes, offset, globalStrings);
      packages.set(packageInfo.id, packageInfo);
    }

    offset += chunkSize;
  }

  return {
    resolveString(resourceId) {
      return resolveResourceString(resourceId >>> 0, packages, bytes, new Set());
    },
    resolveFiles(resourceId) {
      return resolveResourceFiles(resourceId >>> 0, packages, bytes, new Set());
    },
    resolveColor(resourceId) {
      return resolveResourceColor(resourceId >>> 0, packages, bytes, new Set());
    },
  };
}

function parseResourcePackage(bytes, offset, globalStrings) {
  const headerSize = readUint16(bytes, offset + 2);
  const packageSize = readUint32(bytes, offset + 4);
  const id = readUint32(bytes, offset + 8);
  const typeStringsOffset = readUint32(bytes, offset + 268);
  const keyStringsOffset = readUint32(bytes, offset + 276);
  const typeIdOffset = headerSize >= 288 ? readUint32(bytes, offset + 284) : 0;

  const typeStrings = typeStringsOffset ? parseStringPool(bytes, offset + typeStringsOffset) : [];
  const keyStrings = keyStringsOffset ? parseStringPool(bytes, offset + keyStringsOffset) : [];
  const types = new Map();

  let cursor = offset + headerSize;
  const packageEnd = offset + packageSize;
  while (cursor < packageEnd) {
    const chunkType = readUint16(bytes, cursor);
    const chunkSize = readUint32(bytes, cursor + 4);

    if (chunkSize <= 0) {
      throw new Error("resources.arsc package 子块尺寸无效");
    }

    if (chunkType === RES_TABLE_TYPE_TYPE) {
      const typeChunk = parseTypeChunk(bytes, cursor);
      const typeId = typeChunk.id + typeIdOffset;
      typeChunk.typeName = typeStrings[typeChunk.id - 1] || null;
      const bucket = types.get(typeId) || [];
      bucket.push(typeChunk);
      types.set(typeId, bucket);
    }

    cursor += chunkSize;
  }

  for (const typeChunks of types.values()) {
    typeChunks.sort((left, right) => Number(right.isDefaultConfig) - Number(left.isDefaultConfig));
  }

  return {
    id,
    bytes,
    globalStrings,
    typeStrings,
    keyStrings,
    types,
  };
}

function parseTypeChunk(bytes, offset) {
  const headerSize = readUint16(bytes, offset + 2);
  const flags = bytes[offset + 9];
  const entryCount = readUint32(bytes, offset + 12);
  const entriesStart = readUint32(bytes, offset + 16);
  const configBytes = bytes.subarray(offset + 20, offset + headerSize);

  return {
    offset,
    id: bytes[offset + 8],
    flags,
    entryCount,
    entriesStart,
    indexOffset: offset + headerSize,
    density: readResourceConfigDensity(configBytes),
    isDefaultConfig: isDefaultResourceConfig(configBytes),
  };
}

function readResourceConfigDensity(configBytes) {
  return configBytes.length >= 16 ? readUint16(configBytes, 14) : 0;
}

function resolveResourceString(resourceId, packages, bytes, seen) {
  if (seen.has(resourceId)) {
    return null;
  }

  seen.add(resourceId);

  const packageId = resourceId >>> 24;
  const typeId = (resourceId >>> 16) & 0xff;
  const entryId = resourceId & 0xffff;

  const packageInfo = packages.get(packageId);
  if (!packageInfo) {
    return null;
  }

  const typeChunks = packageInfo.types.get(typeId);
  if (!typeChunks) {
    return null;
  }

  const typeName = typeChunks[0]?.typeName || packageInfo.typeStrings[typeId - 1];
  if (typeName && typeName !== "string") {
    return null;
  }

  for (const typeChunk of typeChunks) {
    const relativeEntryOffset = findEntryOffset(bytes, typeChunk, entryId);
    if (relativeEntryOffset == null) {
      continue;
    }

    const value = readResourceValue(bytes, typeChunk, relativeEntryOffset);
    if (!value) {
      continue;
    }

    if (value.dataType === TYPE_STRING) {
      return packageInfo.globalStrings[value.data] || null;
    }

    if (value.dataType === TYPE_REFERENCE || value.dataType === TYPE_DYNAMIC_REFERENCE) {
      return resolveResourceString(value.data >>> 0, packages, bytes, seen);
    }

    if (value.dataType === TYPE_INT_DEC) {
      return String(toSigned32(value.data));
    }

    if (value.dataType === TYPE_INT_HEX) {
      return `0x${(value.data >>> 0).toString(16)}`;
    }
  }

  return null;
}

function resolveResourceFiles(resourceId, packages, bytes, seen) {
  if (seen.has(resourceId)) {
    return [];
  }

  seen.add(resourceId);

  const packageId = resourceId >>> 24;
  const typeId = (resourceId >>> 16) & 0xff;
  const entryId = resourceId & 0xffff;

  const packageInfo = packages.get(packageId);
  if (!packageInfo) {
    return [];
  }

  const typeChunks = packageInfo.types.get(typeId);
  if (!typeChunks) {
    return [];
  }

  const typeName = typeChunks[0]?.typeName || packageInfo.typeStrings[typeId - 1];
  if (typeName && typeName !== "drawable" && typeName !== "mipmap") {
    return [];
  }

  const files = [];
  for (const typeChunk of typeChunks) {
    const relativeEntryOffset = findEntryOffset(bytes, typeChunk, entryId);
    if (relativeEntryOffset == null) {
      continue;
    }

    const value = readResourceValue(bytes, typeChunk, relativeEntryOffset);
    if (!value) {
      continue;
    }

    if (value.dataType === TYPE_STRING) {
      const path = normalizeText(packageInfo.globalStrings[value.data]);
      if (path) {
        files.push({
          path,
          typeName,
          density: typeChunk.density || 0,
          isDefaultConfig: typeChunk.isDefaultConfig,
        });
      }
    } else if (value.dataType === TYPE_REFERENCE || value.dataType === TYPE_DYNAMIC_REFERENCE) {
      files.push(...resolveResourceFiles(value.data >>> 0, packages, bytes, seen));
    }
  }

  return files;
}

function resolveResourceColor(resourceId, packages, bytes, seen) {
  if (seen.has(resourceId)) {
    return null;
  }

  seen.add(resourceId);

  const packageId = resourceId >>> 24;
  const typeId = (resourceId >>> 16) & 0xff;
  const entryId = resourceId & 0xffff;

  const packageInfo = packages.get(packageId);
  if (!packageInfo) {
    return null;
  }

  const typeChunks = packageInfo.types.get(typeId);
  if (!typeChunks) {
    return null;
  }

  for (const typeChunk of typeChunks) {
    const relativeEntryOffset = findEntryOffset(bytes, typeChunk, entryId);
    if (relativeEntryOffset == null) {
      continue;
    }

    const value = readResourceValue(bytes, typeChunk, relativeEntryOffset);
    if (!value) {
      continue;
    }

    if (value.dataType >= TYPE_FIRST_COLOR_INT && value.dataType <= TYPE_LAST_COLOR_INT) {
      return formatCssColor(value.data);
    }

    if (value.dataType === TYPE_STRING) {
      return normalizeColorText(packageInfo.globalStrings[value.data]);
    }

    if (value.dataType === TYPE_REFERENCE || value.dataType === TYPE_DYNAMIC_REFERENCE) {
      return resolveResourceColor(value.data >>> 0, packages, bytes, seen);
    }
  }

  return null;
}

function findEntryOffset(bytes, typeChunk, entryId) {
  if ((typeChunk.flags & TYPE_FLAG_SPARSE) !== 0) {
    let left = 0;
    let right = typeChunk.entryCount - 1;
    while (left <= right) {
      const middle = Math.floor((left + right) / 2);
      const indexOffset = typeChunk.indexOffset + middle * 4;
      const sparseEntryId = readUint16(bytes, indexOffset);

      if (sparseEntryId === entryId) {
        return readUint16(bytes, indexOffset + 2) * 4;
      }

      if (sparseEntryId < entryId) {
        left = middle + 1;
      } else {
        right = middle - 1;
      }
    }

    return null;
  }

  if (entryId >= typeChunk.entryCount) {
    return null;
  }

  if ((typeChunk.flags & TYPE_FLAG_OFFSET16) !== 0) {
    const offset16 = readUint16(bytes, typeChunk.indexOffset + entryId * 2);
    return offset16 === TABLE_NO_ENTRY_16 ? null : offset16 * 4;
  }

  const entryOffset = readUint32(bytes, typeChunk.indexOffset + entryId * 4);
  return entryOffset === ZIP_NO_ENTRY ? null : entryOffset;
}

function readResourceValue(bytes, typeChunk, relativeEntryOffset) {
  const entryOffset = typeChunk.offset + typeChunk.entriesStart + relativeEntryOffset;
  const entryFlags = readUint16(bytes, entryOffset + 2);

  if ((entryFlags & ENTRY_FLAG_COMPLEX) !== 0) {
    return null;
  }

  if ((entryFlags & ENTRY_FLAG_COMPACT) !== 0) {
    return {
      dataType: entryFlags >>> 8,
      data: readUint32(bytes, entryOffset + 4),
    };
  }

  const entrySize = readUint16(bytes, entryOffset);
  const valueOffset = entryOffset + entrySize;

  return {
    dataType: bytes[valueOffset + 3],
    data: readUint32(bytes, valueOffset + 4),
  };
}

function parseXmlResourceMap(bytes, offset) {
  const headerSize = readUint16(bytes, offset + 2);
  const chunkSize = readUint32(bytes, offset + 4);
  const count = Math.max(0, Math.floor((chunkSize - headerSize) / 4));
  const resourceMap = new Array(count);

  for (let index = 0; index < count; index += 1) {
    resourceMap[index] = readUint32(bytes, offset + headerSize + index * 4);
  }

  return resourceMap;
}

function getAndroidAttributeName(resourceId) {
  switch (resourceId) {
    case 0x01010001:
      return "label";
    case 0x01010002:
      return "icon";
    case 0x01010003:
      return "name";
    case 0x01010006:
      return "permission";
    case 0x01010010:
      return "exported";
    case 0x01010011:
      return "process";
    case 0x0101000f:
      return "targetActivity";
    case 0x01010018:
      return "enabled";
    case 0x0101002b:
      return "authorities";
    case 0x010102e9:
      return "resource";
    case 0x01010199:
      return "drawable";
    case 0x01010024:
      return "value";
    case 0x01010155:
      return "height";
    case 0x01010159:
      return "width";
    case 0x010101b5:
      return "pivotX";
    case 0x010101b6:
      return "pivotY";
    case 0x0101019d:
      return "startColor";
    case 0x0101019e:
      return "endColor";
    case 0x010101a0:
      return "angle";
    case 0x010101a1:
      return "type";
    case 0x010101a2:
      return "centerX";
    case 0x010101a3:
      return "centerY";
    case 0x010101a4:
      return "gradientRadius";
    case 0x010101a5:
      return "color";
    case 0x0101020b:
      return "centerColor";
    case 0x01010324:
      return "scaleX";
    case 0x01010325:
      return "scaleY";
    case 0x01010326:
      return "rotation";
    case 0x0101052c:
      return "roundIcon";
    case 0x01010586:
      return "foreground";
    case 0x01010587:
      return "background";
    case 0x010106e9:
      return "monochrome";
    case 0x01010402:
      return "viewportWidth";
    case 0x01010403:
      return "viewportHeight";
    case 0x01010404:
      return "fillColor";
    case 0x01010405:
      return "pathData";
    case 0x01010406:
      return "strokeColor";
    case 0x01010407:
      return "strokeWidth";
    case 0x01010510:
      return "startX";
    case 0x01010511:
      return "startY";
    case 0x01010512:
      return "endX";
    case 0x01010513:
      return "endY";
    case 0x01010514:
      return "offset";
    case 0x0101045a:
      return "translateX";
    case 0x0101045b:
      return "translateY";
    case 0x010104cb:
      return "strokeAlpha";
    case 0x010104cc:
      return "fillAlpha";
    default:
      return null;
  }
}

function parseStringPool(bytes, offset) {
  const stringCount = readUint32(bytes, offset + 8);
  const flags = readUint32(bytes, offset + 16);
  const stringsStart = readUint32(bytes, offset + 20);
  const isUtf8 = (flags & STRING_POOL_UTF8_FLAG) !== 0;
  const headerSize = readUint16(bytes, offset + 2);

  const indicesOffset = offset + headerSize;
  const stringsBase = offset + stringsStart;

  const strings = new Array(stringCount);
  for (let index = 0; index < stringCount; index += 1) {
    const stringOffset = readUint32(bytes, indicesOffset + index * 4);
    strings[index] = isUtf8
      ? readUtf8String(bytes, stringsBase + stringOffset)
      : readUtf16String(bytes, stringsBase + stringOffset);
  }

  return strings;
}

function readUtf8String(bytes, offset) {
  const utf16Length = readLength8(bytes, offset);
  const utf8Length = readLength8(bytes, utf16Length.nextOffset);
  return decodeUtf8(bytes.subarray(utf8Length.nextOffset, utf8Length.nextOffset + utf8Length.length));
}

function readUtf16String(bytes, offset) {
  const lengthInfo = readLength16(bytes, offset);
  return decodeUtf16(bytes, lengthInfo.nextOffset, lengthInfo.length);
}

function readLength8(bytes, offset) {
  const first = bytes[offset];
  if ((first & 0x80) === 0) {
    return {
      length: first,
      nextOffset: offset + 1,
    };
  }

  return {
    length: ((first & 0x7f) << 8) | bytes[offset + 1],
    nextOffset: offset + 2,
  };
}

function readLength16(bytes, offset) {
  const first = readUint16(bytes, offset);
  if ((first & 0x8000) === 0) {
    return {
      length: first,
      nextOffset: offset + 2,
    };
  }

  return {
    length: ((first & 0x7fff) << 16) | readUint16(bytes, offset + 2),
    nextOffset: offset + 4,
  };
}

function decodeUtf8(bytes) {
  return utf8Decoder.decode(bytes);
}

function decodeUtf16(bytes, offset, codeUnitCount) {
  let result = "";
  for (let index = 0; index < codeUnitCount; index += 1) {
    result += String.fromCharCode(readUint16(bytes, offset + index * 2));
  }
  return result;
}

function normalizeText(value) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toInteger(attribute) {
  if (!attribute) {
    return null;
  }

  if (attribute.dataType === TYPE_INT_DEC || attribute.dataType === TYPE_INT_HEX) {
    return attribute.data >>> 0;
  }

  const normalized = normalizeText(attribute.displayValue);
  if (!normalized || !/^\d+$/.test(normalized)) {
    return null;
  }

  return Number.parseInt(normalized, 10);
}

function combineVersionCode(versionCodeLow, versionCodeHigh) {
  const low = BigInt(versionCodeLow || 0);
  const high = BigInt(versionCodeHigh || 0);
  return String((high << 32n) | low);
}

function formatResourceReference(resourceId) {
  return `@0x${(resourceId >>> 0).toString(16)}`;
}

function formatCssColor(value) {
  const normalized = value >>> 0;
  const alpha = (normalized >>> 24) & 0xff;
  const red = (normalized >>> 16) & 0xff;
  const green = (normalized >>> 8) & 0xff;
  const blue = normalized & 0xff;

  if (alpha === 0xff) {
    return `#${toHex2(red)}${toHex2(green)}${toHex2(blue)}`;
  }

  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3)})`;
}

function toHex2(value) {
  return value.toString(16).padStart(2, "0");
}

function isDefaultResourceConfig(configBytes) {
  for (let index = 4; index < configBytes.length; index += 1) {
    if (configBytes[index] !== 0) {
      return false;
    }
  }

  return true;
}

function getString(strings, index) {
  if (index === AXML_NO_INDEX || index < 0 || index >= strings.length) {
    return null;
  }

  return strings[index];
}

function toSigned32(value) {
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  return new Uint8Array(value);
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readUint64(bytes, offset) {
  const low = BigInt(readUint32(bytes, offset));
  const high = BigInt(readUint32(bytes, offset + 4));
  const value = (high << 32n) | low;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("64-bit value exceeds safe integer range");
  }

  return Number(value);
}

function ensureReadable(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) {
    throw new Error("数据读取越界");
  }
}
