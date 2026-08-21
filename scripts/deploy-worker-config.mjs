export function createWorkerConfigWithSdkEmojiKvNamespace(config, workerEnv, namespaceId) {
  const normalizedWorkerEnv = normalizeRequiredText(workerEnv, "Worker environment name");
  const normalizedNamespaceId = normalizeRequiredText(namespaceId, "SDK emoji KV namespace id");
  const nextConfig = JSON.parse(JSON.stringify(config));
  const targetEnv = nextConfig.env?.[normalizedWorkerEnv];

  if (!targetEnv) {
    throw new Error(`Missing Worker environment in config: ${normalizedWorkerEnv}`);
  }

  targetEnv.kv_namespaces = [
    ...(Array.isArray(targetEnv.kv_namespaces) ? targetEnv.kv_namespaces : [])
      .filter((namespace) => namespace?.binding !== "SDK_EMOJI_KV"),
    { binding: "SDK_EMOJI_KV", id: normalizedNamespaceId },
  ];

  return nextConfig;
}

function normalizeRequiredText(value, label) {
  const text = value == null ? "" : String(value).trim();
  if (!text) {
    throw new Error(`Missing ${label}.`);
  }
  return text;
}
