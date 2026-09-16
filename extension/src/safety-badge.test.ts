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
