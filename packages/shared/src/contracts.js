/**
 * Shared data contracts for the Worker, WebUI, and shared analyzer.
 *
 * The project still runs as JavaScript. These JSDoc typedefs give editors and
 * future TypeScript checks one source of truth, while the exported guards cover
 * the few cross-runtime boundaries where malformed payloads are most expensive.
 */

/** @typedef {string | number | boolean} AnalyticsFieldValue */
/** @typedef {Record<string, AnalyticsFieldValue | null | undefined>} AnalyticsEventFields */
/** @typedef {{ event: string, surface?: string, path?: string, session_id?: string } & Record<string, AnalyticsFieldValue>} AnalyticsEventPayload */

/**
 * @typedef {object} TerminalSystem
 * @property {string} name
 * @property {string} version
 * @property {string} source
 */

/**
 * @typedef {object} ApkIcon
 * @property {string=} dataUri
 * @property {string=} path
 * @property {number=} width
 * @property {number=} height
 * @property {string=} mimeType
 */

/**
 * @typedef {object} ApkNativeLibrary
 * @property {string} name
 * @property {string} abi
 * @property {string=} path
 * @property {number=} size
 * @property {number=} elfPageSize
 * @property {boolean=} elf16kbAligned
 * @property {number=} zipAlignment
 * @property {boolean=} zip16kbAligned
 * @property {SdkMarker | null=} sdk
 */

/**
 * @typedef {object} ApkComponent
 * @property {string} name
 * @property {string=} shortName
 * @property {boolean=} exported
 * @property {boolean=} enabled
 * @property {string=} permission
 * @property {string[]=} actions
 * @property {string[]=} categories
 * @property {SdkMarker | null=} sdk
 */

/**
 * @typedef {object} ApkComponentGroups
 * @property {ApkComponent[]} activities
 * @property {ApkComponent[]} services
 * @property {ApkComponent[]} receivers
 * @property {ApkComponent[]} providers
 */

/**
 * @typedef {object} ApkArchiveEntry
 * @property {string} path
 * @property {string} name
 * @property {number} size
 * @property {number} compressedSize
 * @property {number} uncompressedSize
 * @property {boolean} analyzed
 */

/**
 * @typedef {object} ApkArchiveInfo
 * @property {"package-container"} type
 * @property {string} analyzedEntry
 * @property {number} apkEntryCount
 * @property {string[]} apkEntries
 * @property {ApkArchiveEntry[]} apkEntryDetails
 */

/**
 * @typedef {object} ApkBuildFeatures
 * @property {boolean} kotlinDetected
 * @property {string | null} kotlinVersion
 * @property {boolean} composeDetected
 * @property {string | null} composeVersion
 * @property {string | null} gradleVersion
 * @property {string | null} agpVersion
 * @property {string | null} appMetadataVersion
 * @property {Record<string, boolean>=} nativeValidation
 */

/**
 * @typedef {object} ApkSignatureInfo
 * @property {Array<Record<string, unknown>>=} certificates
 * @property {Array<Record<string, unknown>>=} signers
 * @property {Record<string, unknown>=} schemes
 */

/**
 * @typedef {object} ApkInfo
 * @property {string} appName
 * @property {string} packageName
 * @property {string} versionName
 * @property {string} versionCode
 * @property {string} minSdk
 * @property {string} targetSdk
 * @property {string} compileSdk
 * @property {ApkIcon | null} icon
 * @property {string[]} permissions
 * @property {ApkNativeLibrary[]} nativeLibraries
 * @property {ApkComponentGroups} components
 * @property {{ application: Array<Record<string, unknown>>, components: Array<Record<string, unknown>> }} metaData
 * @property {ApkBuildFeatures} buildFeatures
 * @property {ApkSignatureInfo} signatures
 * @property {ApkArchiveInfo=} archive
 * @property {SdkSummary=} sdkSummary
 */

/**
 * @typedef {object} LibCheckerRuleLocaleDetail
 * @property {string} label
 * @property {string=} team
 * @property {string=} description
 * @property {string=} source
 * @property {string[]=} contributors
 */

/**
 * @typedef {object} LibCheckerRuleDetail
 * @property {Record<string, LibCheckerRuleLocaleDetail>} locales
 * @property {string=} uuid
 * @property {string=} path
 */

/**
 * @typedef {object} LibCheckerRuleCore
 * @property {string} name
 * @property {string} label
 * @property {number} type
 * @property {number} iconIndex
 * @property {string} iconName
 * @property {boolean} singleColorIcon
 * @property {boolean} isRegexRule
 * @property {string | null} regexName
 */

/** @typedef {LibCheckerRuleCore & { ruleDetail?: LibCheckerRuleDetail | null }} LibCheckerRule */

/** @typedef {Record<string, LibCheckerRuleDetail>} LibCheckerRuleDetailMap */

/** @typedef {"exact" | "regex" | "action"} SdkMarkerMatchSource */

/**
 * @typedef {object} SdkMarker
 * @property {string} label
 * @property {string} iconName
 * @property {string} iconUrl
 * @property {boolean} singleColorIcon
 * @property {SdkMarkerMatchSource} matchSource
 * @property {string | null} regexName
 * @property {string | null=} detailKey
 * @property {LibCheckerRuleDetail | null} ruleDetail
 * @property {number} type
 */

/**
 * @typedef {object} SdkSummaryEntry
 * @property {string} key
 * @property {string} label
 * @property {string} iconName
 * @property {string} iconUrl
 * @property {boolean} singleColorIcon
 * @property {string | null=} detailKey
 * @property {LibCheckerRuleDetail | null} ruleDetail
 * @property {number} count
 * @property {string} detail
 * @property {string[]} previewItems
 */

/**
 * @typedef {object} SdkSummary
 * @property {SdkSummaryEntry[]} native
 * @property {SdkSummaryEntry[]} components
 */

/**
 * @typedef {object} SdkMarkerAnnotations
 * @property {ApkNativeLibrary[]} nativeLibraries
 * @property {ApkComponentGroups} components
 * @property {SdkSummary} sdkSummary
 */

/**
 * @typedef {object} AnalysisProfile
 * @property {string} id
 * @property {string[]} capabilities
 * @property {number} ruleCount
 * @property {number} iconCount
 * @property {number} uniqueSdkCount
 * @property {number} sdkMarkerCount
 * @property {number} nativeSdkMarkerCount
 * @property {number} componentSdkMarkerCount
 * @property {{ worker: boolean, decompressionStream: boolean, system: TerminalSystem }} runtime
 */

/**
 * @typedef {object} ApkReport
 * @property {string} locale
 * @property {TerminalSystem} terminalSystem
 * @property {AnalysisProfile} analysisProfile
 * @property {number} durationMs
 * @property {string} fileName
 * @property {number} fileSizeBytes
 * @property {string} analyzedAt
 * @property {ApkInfo} apkInfo
 */

/**
 * @typedef {object} TelegramApkReport
 * @property {string} locale
 * @property {ApkInfo} apkInfo
 * @property {string} fileName
 * @property {string} fileSizeText
 * @property {string} sourceLabel
 * @property {string} analyzedAt
 * @property {{ kotlin: string, gradle: string, compose: string }} featureIcons
 * @property {boolean=} isCompacted
 * @property {Record<string, number>=} originalStats
 */

/**
 * @typedef {object} AnalyzerWorkerRequest
 * @property {"analyze"} type
 * @property {number} jobId
 * @property {string} locale
 * @property {{ name?: string, type?: string, size?: number, arrayBuffer: () => Promise<ArrayBuffer> }} file
 * @property {TerminalSystem} terminalSystem
 */

/**
 * @typedef {object} AnalyzerWorkerProgressMessage
 * @property {"progress"} type
 * @property {number} jobId
 * @property {"reading" | "parsing"} stage
 */

/**
 * @typedef {object} AnalyzerWorkerResultMessage
 * @property {"result"} type
 * @property {number} jobId
 * @property {ApkReport} report
 */

/**
 * @typedef {object} AnalyzerWorkerErrorMessage
 * @property {"error"} type
 * @property {number} jobId
 * @property {string} error
 */

/** @typedef {AnalyzerWorkerProgressMessage | AnalyzerWorkerResultMessage | AnalyzerWorkerErrorMessage} AnalyzerWorkerResponse */

export const CONTRACT_VERSION = 1;

const WORKER_PROGRESS_STAGES = new Set(["reading", "parsing"]);
const SDK_MARKER_MATCH_SOURCES = new Set(["exact", "regex", "action"]);

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAnalyticsEventName(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isAnalyticsFieldValue(value) {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function isAnalyticsEventPayload(value) {
  if (!isObject(value) || !isAnalyticsEventName(value.event)) {
    return false;
  }

  return Object.entries(value).every(([, entry]) => entry == null || isAnalyticsFieldValue(entry));
}

export function isTerminalSystem(value) {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    typeof value.source === "string"
  );
}

export function isLibCheckerRule(value) {
  return isLibCheckerRuleCore(value);
}

export function isLibCheckerRuleCore(value) {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    typeof value.label === "string" &&
    Number.isFinite(value.type) &&
    Number.isFinite(value.iconIndex) &&
    typeof value.iconName === "string" &&
    typeof value.singleColorIcon === "boolean" &&
    typeof value.isRegexRule === "boolean" &&
    (value.regexName == null || typeof value.regexName === "string")
  );
}

export function isSdkMarker(value) {
  return (
    isObject(value) &&
    typeof value.label === "string" &&
    typeof value.iconName === "string" &&
    typeof value.iconUrl === "string" &&
    typeof value.singleColorIcon === "boolean" &&
    SDK_MARKER_MATCH_SOURCES.has(value.matchSource) &&
    (value.regexName == null || typeof value.regexName === "string") &&
    Number.isFinite(value.type)
  );
}

export function isApkReport(value) {
  return (
    isObject(value) &&
    typeof value.locale === "string" &&
    isTerminalSystem(value.terminalSystem) &&
    isObject(value.analysisProfile) &&
    Number.isFinite(value.durationMs) &&
    typeof value.fileName === "string" &&
    Number.isFinite(value.fileSizeBytes) &&
    typeof value.analyzedAt === "string" &&
    isObject(value.apkInfo) &&
    typeof value.apkInfo.packageName === "string" &&
    Array.isArray(value.apkInfo.permissions) &&
    Array.isArray(value.apkInfo.nativeLibraries) &&
    isObject(value.apkInfo.components)
  );
}

export function assertApkReport(value) {
  if (!isApkReport(value)) {
    throw new TypeError("Invalid APK report contract");
  }
  return value;
}

export function isTelegramApkReport(value) {
  return (
    isObject(value) &&
    typeof value.locale === "string" &&
    isObject(value.apkInfo) &&
    typeof value.apkInfo.packageName === "string" &&
    Array.isArray(value.apkInfo.permissions) &&
    Array.isArray(value.apkInfo.nativeLibraries) &&
    isObject(value.apkInfo.components) &&
    typeof value.fileName === "string" &&
    typeof value.fileSizeText === "string" &&
    typeof value.sourceLabel === "string" &&
    typeof value.analyzedAt === "string" &&
    isObject(value.featureIcons) &&
    typeof value.featureIcons.kotlin === "string" &&
    typeof value.featureIcons.gradle === "string" &&
    typeof value.featureIcons.compose === "string"
  );
}

export function assertTelegramApkReport(value) {
  if (!isTelegramApkReport(value)) {
    throw new TypeError("Invalid Telegram APK report contract");
  }
  return value;
}

export function isAnalyzerWorkerRequest(value) {
  return (
    isObject(value) &&
    value.type === "analyze" &&
    Number.isFinite(value.jobId) &&
    typeof value.locale === "string" &&
    isFileLike(value.file) &&
    isTerminalSystem(value.terminalSystem)
  );
}

export function assertAnalyzerWorkerRequest(value) {
  if (!isAnalyzerWorkerRequest(value)) {
    throw new TypeError("Invalid analyzer worker request contract");
  }
  return value;
}

export function isAnalyzerWorkerMessage(value) {
  if (!isObject(value) || !Number.isFinite(value.jobId)) {
    return false;
  }

  if (value.type === "progress") {
    return WORKER_PROGRESS_STAGES.has(value.stage);
  }

  if (value.type === "error") {
    return typeof value.error === "string";
  }

  if (value.type === "result") {
    return isApkReport(value.report);
  }

  return false;
}

function isFileLike(value) {
  return (
    isObject(value) &&
    typeof value.arrayBuffer === "function" &&
    (value.name == null || typeof value.name === "string") &&
    (value.type == null || typeof value.type === "string") &&
    (value.size == null || Number.isFinite(value.size))
  );
}
