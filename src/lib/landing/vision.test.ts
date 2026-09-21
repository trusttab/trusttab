import assert from "node:assert/strict";
import { test } from "node:test";

import { VISION_AREAS, VISION_INTRO } from "./vision";
import { NEXT_STAGES, STAGES } from "./stages";

const ALL_COPY = [VISION_INTRO, ...VISION_AREAS.flatMap((a) => [a.name, a.body])];

/** The same rule the Protection stage is held to, applied to the vision copy. */
test("nothing here claims TrustTab does any of it", () => {
  const claims =
    /\b(blocks|refuses|protects|protecting|prevents|preventing|stops|enforces|defends|detects|monitors|verifies|catches|flags|lets you|gives you|you can|available now|we offer|we provide)\b/i;
  for (const text of ALL_COPY) assert.doesNotMatch(text, claims, `present-tense capability claim: "${text.slice(0, 70)}…"`);
});

/**
 * A vision section is exactly where a roadmap promise creeps in, so dates and
 * commitment language are forbidden outright rather than left to judgment.
 */
test("nothing here promises a date or commits to shipping", () => {
  const promises =
    /\b(will ship|shipping|coming soon|coming in|launch(es|ing)?|release[sd]?|planned|upcoming|next quarter|Q[1-4]\b|20\d\d|roadmap item|on the roadmap|soon)\b/i;
  for (const text of VISION_AREAS.flatMap((a) => [a.name, a.body])) {
    assert.doesNotMatch(text, promises, `promise: "${text.slice(0, 70)}…"`);
  }
  // The intro may say the word "roadmap" — but only to deny being one.
  assert.match(VISION_INTRO, /isn't a roadmap/i);
});

test("the intro says plainly that none of it exists and nothing is committed", () => {
  assert.match(VISION_INTRO, /none of this exists/i);
  assert.match(VISION_INTRO, /no dates and no commitments/i);
  assert.match(VISION_INTRO, /not being worked on|none of it is being worked on/i);
});

test("each area names itself and explains the problem rather than a product", () => {
  assert.equal(VISION_AREAS.length, 3);
  assert.deepEqual(
    VISION_AREAS.map((a) => a.name),
    ["AI voice calls", "AI-generated phishing", "Agent-workflow reliability"],
  );
  for (const area of VISION_AREAS) assert.ok(area.body.length > 80, `${area.name} is explained`);
});

/**
 * Each area ends on what isn't known or isn't measured, rather than on what
 * TrustTab would do about it — the difference between describing a problem and
 * implying a product.
 */
test("each area admits a limit in its own words", () => {
  const admissions = /open question we haven't answered|only approach that would survive|Nothing here measures that/;
  for (const area of VISION_AREAS) assert.match(area.body, admissions, `${area.name} states its limit`);
});

/** The vision is separate from the five stages, and must not become a sixth. */
test("the vision areas are not stages", () => {
  const stageNames = new Set(STAGES.map((s) => s.name.toLowerCase()));
  for (const area of VISION_AREAS) assert.ok(!stageNames.has(area.name.toLowerCase()), `${area.name} is not a stage`);
  assert.equal(NEXT_STAGES.length, 1, "Protection is still the only unshipped stage");
  assert.equal(NEXT_STAGES[0].name, "Protection");
});
