import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldAnimateDotField } from "../src/app/background-effects.js";

const eligible = {
  powerConstrained: false,
  visibilityState: "visible",
  fineHover: true,
  canvasVisible: true,
};

test("dot field animates only while visible on capable fine-pointer devices", () => {
  assert.equal(shouldAnimateDotField(eligible), true);
  assert.equal(shouldAnimateDotField({ ...eligible, powerConstrained: true }), false);
  assert.equal(shouldAnimateDotField({ ...eligible, visibilityState: "hidden" }), false);
  assert.equal(shouldAnimateDotField({ ...eligible, fineHover: false }), false);
  assert.equal(shouldAnimateDotField({ ...eligible, canvasVisible: false }), false);
});
