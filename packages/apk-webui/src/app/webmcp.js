export async function initWebMcp(adapters, options = {}) {
  const documentRef = options.documentRef || globalThis.document;
  const navigatorRef = options.navigatorRef || globalThis.navigator;
  const modelContext = navigatorRef?.modelContext || documentRef?.modelContext;
  if (typeof modelContext?.registerTool !== "function") {
    return null;
  }

  const AbortControllerClass = options.AbortControllerClass || globalThis.AbortController;
  const abortController = new AbortControllerClass();
  const registrationOptions = {
    signal: abortController.signal,
  };

  const tools = createWebMcpTools(adapters);
  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, registrationOptions);
    }
  } catch (error) {
    abortController.abort(error);
    throw error;
  }

  documentRef.defaultView?.addEventListener("pagehide", () => {
    abortController.abort();
  }, { once: true });

  return abortController;
}

export function createWebMcpTools({ analyzeUrl, getCurrentReport }) {
  if (typeof analyzeUrl !== "function" || typeof getCurrentReport !== "function") {
    throw new TypeError("WebMCP adapters must provide analyzeUrl and getCurrentReport functions");
  }

  return [
    {
      name: "analyze-android-package-url",
      title: "Analyze Android package URL",
      description: "Analyze a public HTTP or HTTPS APK, APKS, APKM, or XAPK download URL and return a concise package summary. The page displays the complete report.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: {
            type: "string",
            format: "uri",
            pattern: "^https?://",
            description: "Public Android package download URL",
          },
        },
      },
      execute: async ({ url }) => summarizeReport(await analyzeUrl(url)),
      annotations: {
        untrustedContentHint: true,
      },
    },
    {
      name: "get-current-android-package-summary",
      title: "Get current package summary",
      description: "Return a concise summary of the Android package report currently displayed on the page.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: async () => summarizeReport(getCurrentReport()),
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
    },
  ];
}

export function summarizeReport(report) {
  if (!report?.apkInfo) {
    return {
      status: "empty",
      message: "No Android package report is currently available.",
    };
  }

  const info = report.apkInfo;
  return {
    status: "ok",
    fileName: report.fileName || "",
    sourceUrl: report.sourceUrl || "",
    appName: info.appName || "",
    packageName: info.packageName || "",
    versionName: info.versionName || "",
    versionCode: info.versionCode ?? "",
    minSdk: info.minSdk ?? "",
    targetSdk: info.targetSdk ?? "",
    permissionsCount: info.permissions?.length || 0,
    nativeLibrariesCount: info.nativeLibraries?.length || 0,
    componentsCount: countComponents(info.components),
    sdkMarkersCount: (info.sdkSummary?.native?.length || 0) + (info.sdkSummary?.components?.length || 0),
    analyzedAt: report.analyzedAt || "",
  };
}

function countComponents(components = {}) {
  return ["activities", "services", "receivers", "providers"]
    .reduce((total, key) => total + (components[key]?.length || 0), 0);
}
