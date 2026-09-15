import assert from "node:assert/strict";
import { test } from "node:test";

import { aiTextRateLimits } from "./limits";

test("per-IP limits come before the global budget, with the approved values", () => {
  const rules = aiTextRateLimits({});
  assert.deepEqual(
    rules.map((r) => [r.name, r.limit, r.windowSeconds, r.perClient ?? true]),
    [
      ["ai-text-hour", 10, 3600, true],
      ["ai-text-day", 30, 86400, true],
      ["ai-text-all", 1000, 86400, false],
    ],
  );
});

test("AI_TEXT_DAILY_CAP overrides the global budget; invalid values fall back", () => {
  assert.equal(aiTextRateLimits({ AI_TEXT_DAILY_CAP: "250" })[2].limit, 250);
  assert.equal(aiTextRateLimits({ AI_TEXT_DAILY_CAP: "0" })[2].limit, 0);
  assert.equal(aiTextRateLimits({ AI_TEXT_DAILY_CAP: "lots" })[2].limit, 1000);
  assert.equal(aiTextRateLimits({ AI_TEXT_DAILY_CAP: "-5" })[2].limit, 1000);
});
