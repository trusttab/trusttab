import assert from "node:assert/strict";
import { test } from "node:test";

import { aiImageRateLimits, aiTextRateLimits } from "./limits";

const shape = (rules: ReturnType<typeof aiTextRateLimits>) => rules.map((r) => [r.name, r.limit, r.windowSeconds, r.perClient ?? true]);

test("text and image checks have their own per-IP limits, then one shared global budget", () => {
  assert.deepEqual(shape(aiTextRateLimits({})), [
    ["ai-text-hour", 10, 3600, true],
    ["ai-text-day", 30, 86400, true],
    ["ai-check-all", 1000, 86400, false],
  ]);
  assert.deepEqual(shape(aiImageRateLimits({})), [
    ["ai-image-hour", 10, 3600, true],
    ["ai-image-day", 30, 86400, true],
    ["ai-check-all", 1000, 86400, false],
  ]);
});

test("AI_CHECK_DAILY_CAP overrides the shared budget; invalid values fall back", () => {
  assert.equal(aiImageRateLimits({ AI_CHECK_DAILY_CAP: "250" })[2].limit, 250);
  assert.equal(aiTextRateLimits({ AI_CHECK_DAILY_CAP: "0" })[2].limit, 0);
  assert.equal(aiTextRateLimits({ AI_CHECK_DAILY_CAP: "lots" })[2].limit, 1000);
  assert.equal(aiTextRateLimits({ AI_CHECK_DAILY_CAP: "-5" })[2].limit, 1000);
});
