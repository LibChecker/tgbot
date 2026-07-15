import assert from "node:assert/strict";
import { test } from "node:test";

import { annotateSdkMarkers } from "../src/sdk-markers.js";

test("native SDK summaries preserve structured counts for localized rendering", () => {
  const apkInfo = {
    nativeLibraries: [
      { name: "libsample.so", abi: "x86_64" },
      { name: "libsample.so", abi: "arm64-v8a" },
    ],
    components: {
      activities: [],
      services: [],
      receivers: [],
      providers: [],
    },
    buildFeatures: {},
  };
  const rules = [{
    name: "libsample.so",
    label: "Sample SDK",
    type: 0,
    iconIndex: 1,
    iconName: "ic_sample",
    singleColorIcon: false,
    isRegexRule: false,
    regexName: null,
  }];

  const annotated = annotateSdkMarkers(apkInfo, (iconName) => `/icons/${iconName}.svg`, rules);

  assert.deepEqual(
    annotated.sdkSummary.native.map(({ count, fileCount, abis }) => ({ count, fileCount, abis })),
    [{ count: 1, fileCount: 2, abis: ["arm64-v8a", "x86_64"] }],
  );
  assert.equal(annotated.nativeLibraries[0].sdk.detailKey, "0::libsample.so");
  assert.equal(annotated.nativeLibraries[0].sdk.ruleDetail, null);
  assert.equal(annotated.sdkSummary.native[0].detailKey, "0::libsample.so");
  assert.equal(annotated.sdkSummary.native[0].ruleDetail, null);
});
