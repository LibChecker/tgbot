export const SDK_EMOJI_KV_KEY = "telegram-sdk-emojis:manifest:v1";

/**
 * @param {Pick<Env, "SDK_EMOJI_KV">} env
 */
export async function loadSdkCustomEmojiIds(env) {
  const namespace = env?.SDK_EMOJI_KV;
  if (!namespace || typeof namespace.get !== "function") {
    return {};
  }

  return readSdkCustomEmojiIds(namespace);
}

export function extractSdkCustomEmojiIds(value) {
  const ids = extractIdsObject(value?.ids) || extractIdsObject(value?.customEmojiIds);
  if (ids) {
    return ids;
  }

  const manifest = value?.manifest && typeof value.manifest === "object" ? value.manifest : value;
  if (!manifest?.icons || typeof manifest.icons !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(manifest.icons)
      .filter(([, entry]) => typeof entry?.customEmojiId === "string" && entry.customEmojiId)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([iconName, entry]) => [iconName, entry.customEmojiId]),
  );
}

async function readSdkCustomEmojiIds(namespace) {
  try {
    const value = await namespace.get(SDK_EMOJI_KV_KEY, "json");
    const ids = extractSdkCustomEmojiIds(value);
    return Object.keys(ids).length > 0 ? ids : {};
  } catch {
    return {};
  }
}

function extractIdsObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value)
    .filter(([iconName, customEmojiId]) => typeof iconName === "string" && typeof customEmojiId === "string" && customEmojiId)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}
