export function stripDataUris(value) {
  if (Array.isArray(value)) {
    return value.map(stripDataUris);
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.startsWith("data:image/")) {
      return `[omitted ${value.length} chars]`;
    }
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "string" && entry.startsWith("data:image/")
        ? `[omitted ${entry.length} chars]`
        : stripDataUris(entry),
    ]),
  );
}

export function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(2)} ${units[index]}`;
}

export function formatResourceId(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return String(value);
  }

  return `0x${(numberValue >>> 0).toString(16).padStart(8, "0")}`;
}

export function sanitizeFilePart(value) {
  return String(value || "apk-report").replaceAll(/[^a-z0-9._-]+/giu, "_").slice(0, 120) || "apk-report";
}

export function sanitizeImageSrc(value) {
  const src = String(value || "");
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml)(?:;[a-z0-9=_-]+)*(?:;base64)?,/iu.test(src)) {
    return src;
  }

  return "";
}

export function getInitial(value) {
  const normalized = String(value || "A").trim();
  return [...normalized][0]?.toUpperCase() || "A";
}
