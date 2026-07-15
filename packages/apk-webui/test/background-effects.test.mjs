import assert from "node:assert/strict";
import { test } from "node:test";

import {
  shouldAnimateDotField,
  shouldContinueDotFieldAnimation,
} from "../src/app/background-effects.js";

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

test("dot field stops once pointer, glow, and displaced dots have settled", () => {
  const settled = {
    pointerSpeed: 0,
    engagement: 0,
    glowOpacity: 0,
    hasUnsettledDots: false,
  };

  assert.equal(shouldContinueDotFieldAnimation(settled), false);
  assert.equal(shouldContinueDotFieldAnimation({ ...settled, pointerSpeed: 0.01 }), true);
  assert.equal(shouldContinueDotFieldAnimation({ ...settled, engagement: 0.01 }), true);
  assert.equal(shouldContinueDotFieldAnimation({ ...settled, glowOpacity: 0.01 }), true);
  assert.equal(shouldContinueDotFieldAnimation({ ...settled, hasUnsettledDots: true }), true);
});
