import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerConfigWithSdkEmojiKvNamespace } from "../deploy-worker-config.mjs";

test("adds SDK emoji KV binding only to the selected Worker environment", () => {
  const config = {
    env: {
      preview: {
        name: "tgbot-preview",
      },
      production: {
        name: "tgbot",
      },
    },
  };

  const nextConfig = createWorkerConfigWithSdkEmojiKvNamespace(config, "preview", "preview-kv-id");

  assert.deepEqual(nextConfig.env.preview.kv_namespaces, [
    {
      binding: "SDK_EMOJI_KV",
      id: "preview-kv-id",
    },
  ]);
  assert.equal(nextConfig.env.production.kv_namespaces, undefined);
});

test("preserves existing KV namespaces in the target Worker environment", () => {
  const config = {
    env: {
      production: {
        kv_namespaces: [
          {
            binding: "EXISTING_KV",
            id: "existing-id",
          },
        ],
      },
    },
  };

  const nextConfig = createWorkerConfigWithSdkEmojiKvNamespace(config, "production", "sdk-emoji-id");

  assert.deepEqual(nextConfig.env.production.kv_namespaces, [
    {
      binding: "EXISTING_KV",
      id: "existing-id",
    },
    {
      binding: "SDK_EMOJI_KV",
      id: "sdk-emoji-id",
    },
  ]);
});

test("replaces an existing SDK emoji KV binding instead of creating duplicates", () => {
  const config = {
    env: {
      production: {
        kv_namespaces: [
          { binding: "SDK_EMOJI_KV", id: "stale-id" },
          { binding: "EXISTING_KV", id: "existing-id" },
        ],
      },
    },
  };

  const nextConfig = createWorkerConfigWithSdkEmojiKvNamespace(config, "production", "current-id");

  assert.deepEqual(nextConfig.env.production.kv_namespaces, [
    { binding: "EXISTING_KV", id: "existing-id" },
    { binding: "SDK_EMOJI_KV", id: "current-id" },
  ]);
});

test("does not mutate the source Worker config", () => {
  const config = {
    env: {
      preview: {
        kv_namespaces: [],
      },
    },
  };

  createWorkerConfigWithSdkEmojiKvNamespace(config, "preview", "preview-kv-id");

  assert.deepEqual(config, {
    env: {
      preview: {
        kv_namespaces: [],
      },
    },
  });
});

test("rejects missing Worker environments", () => {
  assert.throws(
    () => createWorkerConfigWithSdkEmojiKvNamespace({ env: {} }, "preview", "preview-kv-id"),
    /Missing Worker environment in config: preview/u,
  );
});

test("rejects empty dynamic inputs", () => {
  assert.throws(
    () => createWorkerConfigWithSdkEmojiKvNamespace({ env: { preview: {} } }, " ", "preview-kv-id"),
    /Missing Worker environment name/u,
  );
  assert.throws(
    () => createWorkerConfigWithSdkEmojiKvNamespace({ env: { preview: {} } }, "preview", ""),
    /Missing SDK emoji KV namespace id/u,
  );
});
