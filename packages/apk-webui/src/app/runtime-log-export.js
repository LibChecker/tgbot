const RUNTIME_LOG_EXPORT_TITLE = "LibChecker WebUI Runtime Logs";
const RUNTIME_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

export async function exportRuntimeLogs({ logs = [], locale = "", version = "dev" } = {}) {
  const text = buildRuntimeLogExportText(logs, locale, version);
  const fileName = `apk-webui-runtime-logs-${formatRuntimeLogExportTimestamp(new Date())}.log`;

  try {
    const file = typeof File === "function"
      ? new File([text], fileName, { type: "text/plain;charset=UTF-8" })
      : null;

    if (file && navigator.share && canShareRuntimeLogFile(file)) {
      await navigator.share({
        title: RUNTIME_LOG_EXPORT_TITLE,
        files: [file],
      });
      return { operation: "share_file" };
    }

    if (navigator.share) {
      await navigator.share({
        title: RUNTIME_LOG_EXPORT_TITLE,
        text,
      });
      return { operation: "share_text" };
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return { cancelled: true, operation: "share" };
    }
  }

  downloadRuntimeLogFile(fileName, text);
  return { operation: "download" };
}

function canShareRuntimeLogFile(file) {
  if (typeof navigator.canShare !== "function") {
    return false;
  }

  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function buildRuntimeLogExportText(logs, locale, version) {
  const lines = [
    RUNTIME_LOG_EXPORT_TITLE,
    `Version: ${version}`,
    `Locale: ${locale}`,
    `Exported At: ${new Date().toISOString()}`,
    `Entries: ${logs.length}`,
    "",
  ];

  for (const entry of logs) {
    lines.push(formatRuntimeLogExportLine(entry));
  }

  return lines.join("\n");
}

function formatRuntimeLogExportLine(entry) {
  const level = RUNTIME_LOG_LEVELS.has(entry.level) ? entry.level : "info";
  const time = new Date(entry.time || Date.now()).toISOString();
  const details = entry.details ? ` ${entry.details}` : "";
  return `[${time}] ${level.toUpperCase()} ${entry.message}${details}`;
}

function formatRuntimeLogExportTimestamp(date) {
  return date.toISOString().replace(/[:.]/gu, "-");
}

function downloadRuntimeLogFile(fileName, text) {
  const blob = new Blob([text], { type: "text/plain;charset=UTF-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
