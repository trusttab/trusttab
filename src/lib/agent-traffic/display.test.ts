import assert from "node:assert/strict";
import { test } from "node:test";

import { REGISTRY_SCOPE_NOTE, TIER_LABELS, TIER_NOTES } from "./display";

/**
 * Pins the wording rules: the verified tier is stated as fact, the heuristic
 * tier always says it's an estimate, and nothing anywhere claims a visitor
 * was human or that an unsigned request means anything.
 */
test("only the heuristic tier is labelled an estimate", () => {
  assert.match(TIER_LABELS.likely_automated, /\(estimate\)/);
  assert.doesNotMatch(TIER_LABELS.verified, /estimate/i);
});

test("the verified tier states the coverage caveat, without implying anything about unsigned traffic", () => {
  assert.match(TIER_NOTES.verified, /most agent traffic is unsigned today/i);
  assert.match(TIER_NOTES.verified, /no signature is not evidence of anything/i);
});

test("the heuristic tier names its own failure modes", () => {
  assert.match(TIER_NOTES.likely_automated, /user agents are self-reported/i);
  assert.match(TIER_NOTES.likely_automated, /uptime monitors, security scanners and ordinary people on VPNs/i);
});

test("nothing claims a visitor was human, and the scope of this data is stated", () => {
  const all = [...Object.values(TIER_LABELS), ...Object.values(TIER_NOTES), REGISTRY_SCOPE_NOTE].join(" ");
  assert.doesNotMatch(all, /human (visitors?|traffic)/i);
  assert.match(REGISTRY_SCOPE_NOTE, /not visits to the site itself/);
});
