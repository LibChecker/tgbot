import assert from "node:assert/strict";
import test from "node:test";

import { assertAnalyzerWorkerRequest } from "../src/contracts.js";

const terminalSystem = {
  name: "macOS",
  version: "15.0",
  source: "test",
};

test("accepts analyzer requests with transferred file buffers", () => {
  const fileBuffer = new ArrayBuffer(4);
  const request = {
    type: "analyze",
    jobId: 1,
    locale: "zh-Hans",
    file: {
      name: "sample.apk",
      type: "application/vnd.android.package-archive",
      size: fileBuffer.byteLength,
    },
    fileBuffer,
    terminalSystem,
  };

  assert.equal(assertAnalyzerWorkerRequest(request), request);
});

test("accepts analyzer requests with legacy file-like payloads", () => {
  const request = {
    type: "analyze",
    jobId: 1,
    locale: "zh-Hans",
    file: {
      name: "sample.apk",
      type: "application/vnd.android.package-archive",
      size: 4,
      arrayBuffer: async () => new ArrayBuffer(4),
    },
    terminalSystem,
  };

  assert.equal(assertAnalyzerWorkerRequest(request), request);
});

test("rejects analyzer requests without a file payload", () => {
  assert.throws(
    () => assertAnalyzerWorkerRequest({
      type: "analyze",
      jobId: 1,
      locale: "zh-Hans",
      file: {
        name: "sample.apk",
      },
      terminalSystem,
    }),
    /Invalid analyzer worker request contract/u,
  );
});
