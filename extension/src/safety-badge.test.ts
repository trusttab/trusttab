import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { summarizeSafety, type SafetyFinding } from "./safety-badge";

const sensitive: SafetyFinding = { check: "sensitive-request", title: "Asks for a verification code", details: ["…"] };
const lookalike: SafetyFinding = { check: "domain-lookalike", title: "Resembles paypal.com", details: ["…"] };

describe("summarizeSafety", () => {
  test("nothing found is green, and doesn't claim the page is safe", () => {
    const summary = summarizeSafety([]);
    assert.equal(summary.tier, "green");
    assert.equal(summary.title, "No concerns found in our checks");
    // The informational cards (native AI platform, self-described AI, tracking)
    // deliberately don't feed this badge, so green sits above cards that do
    // show findings. Without naming that, the two read as a contradiction.
    assert.match(summary.summary, /Anything shown below is information, not a concern/);
    assert.match(summary.summary, /isn't a promise the page is safe/);
  });

  test("one check is yellow, however severe it looks", () => {
    for (const finding of [sensitive, lookalike]) {
      const summary = summarizeSafety([finding]);
      assert.equal(summary.tier, "yellow");
      assert.equal(summary.title, "Something to review");
      assert.deepEqual(summary.findings, [finding]);
    }
  });

  test("two findings from the same check stay yellow", () => {
    const summary = summarizeSafety([sensitive, { ...sensitive, title: "Asks for a password" }]);
    assert.equal(summary.tier, "yellow");
    assert.equal(summary.findings.length, 2);
  });

  test("two independent checks are red, and every finding is listed", () => {
    const summary = summarizeSafety([sensitive, lookalike]);
    assert.equal(summary.tier, "red");
    assert.equal(summary.title, "Multiple signs of a possible scam");
    assert.match(summary.summary, /^2 independent checks/);
    assert.deepEqual(summary.findings, [sensitive, lookalike]);
  });
});

/**
 * The green tier's clause is about informational cards sitting under a badge
 * that found nothing. On yellow and red there are real concerns below, so
 * saying the same thing there would be false.
 */
test("only the green tier says what is below it is not a concern", () => {
  const one = summarizeSafety([{ check: "domain-lookalike", title: "t", details: [] }]);
  const two = summarizeSafety([
    { check: "domain-lookalike", title: "t", details: [] },
    { check: "sensitive-request", title: "t", details: [] },
  ]);
  for (const summary of [one, two]) {
    assert.doesNotMatch(summary.summary, /not a concern/i, `${summary.tier} must not say that`);
  }
});
