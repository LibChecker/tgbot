import assert from "node:assert/strict";
import test from "node:test";

import { logInfoEvent } from "../src/observability.js";

test("analytics datapoints include APK file and package identifiers", () => {
  const datapoints = [];
  const env = {
    USAGE_ANALYTICS: {
      writeDataPoint(point) {
        datapoints.push(point);
      },
    },
  };
  const originalLog = console.log;
  console.log = () => {};

  try {
    logInfoEvent(
      env,
      { request_id: "request-1", surface: "worker", route: "telegram_webhook" },
      "apk.analysis.succeeded",
      {
        result: "success",
        file_name: "sample.apk",
        package_name: "com.example.app",
      },
    );
  } finally {
    console.log = originalLog;
  }

  assert.equal(datapoints.length, 1);
  assert.equal(datapoints[0].blobs.length, 20);
  assert.ok(datapoints[0].blobs.includes("sample.apk"));
  assert.ok(datapoints[0].blobs.includes("com.example.app"));
});
