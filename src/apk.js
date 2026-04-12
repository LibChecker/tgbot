const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_COMPRESSION_STORE = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const ZIP_NO_ENTRY = 0xffffffff;

const RES_STRING_POOL_TYPE = 0x0001;
const RES_TABLE_TYPE = 0x0002;
const RES_XML_TYPE = 0x0003;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;

const STRING_POOL_UTF8_FLAG = 1 << 8;
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_DYNAMIC_REFERENCE = 0x07;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

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

export async function readApkInfo(apkBuffer) {
  const apkBytes = toUint8Array(apkBuffer);
  const zipEntries = parseZipEntries(apkBytes);
  const nativeLibraries = collectNativeLibraries(zipEntries);
  const buildFeatures = await detectBuildFeatures(apkBytes, zipEntries);
  const resources = await readApkResources(apkBytes, zipEntries);

  const manifestEntry = zipEntries.get("AndroidManifest.xml");
  if (!manifestEntry) {
    throw new Error("APK 中缺少 AndroidManifest.xml");
  }

  const manifestBytes = await extractZipEntry(apkBytes, manifestEntry);
  const manifest = parseAndroidManifest(manifestBytes);

  let appName = normalizeText(manifest.applicationLabel);
  if (!appName && manifest.applicationLabelRef != null && resources) {
    appName = normalizeText(resources.resolveString(manifest.applicationLabelRef));
  }

  if (!appName && manifest.applicationLabelRef != null) {
    appName = formatResourceReference(manifest.applicationLabelRef);
  }

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
    permissions: manifest.permissions,
    nativeLibraries,
    components: manifest.components,
    metaData,
    buildFeatures,
  };
}

async function detectBuildFeatures(apkBytes, zipEntries) {
  const appMetadata = await readAppMetadata(apkBytes, zipEntries);
  const composeMetadata = await readComposeMetadata(apkBytes, zipEntries);
  const featureMarkers = await scanDexFeatureMarkers(apkBytes, zipEntries, {
    skipComposeDexScan: composeMetadata.detected,
  });
  const kotlinTooling = await readKotlinToolingMetadata(apkBytes, zipEntries);

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

async function readAppMetadata(apkBytes, zipEntries) {
  const metadataEntry =
    zipEntries.get("META-INF/com/android/build/gradle/app-metadata.properties") ||
    zipEntries.get("BUNDLE-METADATA/com.android.tools.build.gradle/app-metadata.properties");

  if (!metadataEntry) {
    return {
      appMetadataVersion: null,
      androidGradlePluginVersion: null,
    };
  }

  const metadataBytes = await extractZipEntry(apkBytes, metadataEntry);
  const metadataText = decodeUtf8(metadataBytes);
  const properties = parseProperties(metadataText);

  return {
    appMetadataVersion: properties.appMetadataVersion || null,
    androidGradlePluginVersion: properties.androidGradlePluginVersion || null,
  };
}

async function scanDexFeatureMarkers(apkBytes, zipEntries, options = {}) {
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

    const dexBytes = await extractZipEntry(apkBytes, entry);

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

async function readKotlinToolingMetadata(apkBytes, zipEntries) {
  const entry = zipEntries.get("kotlin-tooling-metadata.json");
  if (!entry) {
    return {
      detected: false,
      kotlinVersion: null,
      gradleVersion: null,
    };
  }

  try {
    const bytes = await extractZipEntry(apkBytes, entry);
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

async function readComposeMetadata(apkBytes, zipEntries) {
  const detected = hasComposeMetaInfEntries(zipEntries);
  let composeVersion = null;

  for (const path of COMPOSE_VERSION_ENTRY_CANDIDATES) {
    const entry = zipEntries.get(path);
    if (!entry) {
      continue;
    }

    const bytes = await extractZipEntry(apkBytes, entry);
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

async function readApkResources(apkBytes, zipEntries) {
  const resourcesEntry = zipEntries.get("resources.arsc");
  if (!resourcesEntry) {
    return null;
  }

  try {
    const resourcesBytes = await extractZipEntry(apkBytes, resourcesEntry);
    return parseResourcesTable(resourcesBytes);
  } catch {
    return null;
  }
}

function resolveApplicationMetaData(items, resources) {
  return items.map((item) => resolveMetaDataItem(item, resources));
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

  libraries.sort((left, right) => {
    if (left.abi !== right.abi) {
      return left.abi.localeCompare(right.abi);
    }

    return left.name.localeCompare(right.name);
  });

  return libraries;
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
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      const element = parseXmlStartElement(bytes, offset, stringPool);
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

function parseXmlStartElement(bytes, offset, stringPool) {
  const nameIndex = readUint32(bytes, offset + 20);
  const attributeStart = readUint16(bytes, offset + 24);
  const attributeSize = readUint16(bytes, offset + 26);
  const attributeCount = readUint16(bytes, offset + 28);

  const attributes = new Map();
  let attributeOffset = offset + 16 + attributeStart;
  for (let index = 0; index < attributeCount; index += 1) {
    const name = getString(stringPool, readUint32(bytes, attributeOffset + 4));
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

function coerceTypedValue(rawValue, dataType, data, stringPool) {
  if (rawValue != null) {
    return rawValue;
  }

  if (dataType === TYPE_STRING) {
    return getString(stringPool, data);
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
    isDefaultConfig: isDefaultResourceConfig(configBytes),
  };
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
