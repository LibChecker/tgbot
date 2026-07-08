import assert from "node:assert/strict";
import test from "node:test";

import { loadSdkCustomEmojiIds } from "../src/sdk-emoji-store.js";

test("SDK emoji ids are read fresh after KV changes", async () => {
  const values = [
    { ids: { ic_lib_android: "old_custom" } },
    { ids: {} },
  ];
  const namespace = {
    async get() {
      return values.shift();
    },
  };

  assert.deepEqual(await loadSdkCustomEmojiIds({ SDK_EMOJI_KV: namespace }, 1000), { ic_lib_android: "old_custom" });
  assert.deepEqual(await loadSdkCustomEmojiIds({ SDK_EMOJI_KV: namespace }, 1001), {});
  assert.equal(values.length, 0);
});