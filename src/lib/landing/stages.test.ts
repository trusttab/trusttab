import assert from "node:assert/strict";
import { test } from "node:test";

import { NEXT_STAGES, SHIPPED_STAGES, STAGES } from "./stages";

/**
 * The landing page's honesty rules, pinned.
 *
 * The page renders `SHIPPED_STAGES` and `NEXT_STAGES` in separate sections, so
 * asserting the partition here is what keeps an unshipped stage out of
 * "Available now" — there is no path by which one can be rendered as shipped
 * without this failing. (React components aren't rendered in these tests; the
 * data is the thing worth pinning, because that is what the page reads.)
 */

test("exactly one stage is unshipped, and it is Protection", () => {
  assert.equal(NEXT_STAGES.length, 1, "one unshipped stage");
  assert.equal(NEXT_STAGES[0].name, "Protection");
  assert.equal(SHIPPED_STAGES.length, 4);
  assert.equal(SHIPPED_STAGES.length + NEXT_STAGES.length, STAGES.length, "every stage is in exactly one group");
});

test("the five stages keep their narrative order", () => {
  assert.deepEqual(
    STAGES.map((stage) => stage.name),
    ["Detection", "Verification", "Identity", "Authorization", "Protection"],
  );
});

test("an unshipped stage says plainly that it does not exist", () => {
  for (const stage of NEXT_STAGES) {
    assert.match(
      `${stage.tagline} ${stage.body}`,
      /not built|none of this exists|does not exist|doesn't exist/i,
      `${stage.name} states that it isn't built`,
    );
  }
});

/**
 * Present-indicative capability verbs are what make a roadmap item read as a
 * product. Describing what it *would* do ("rate-limiting or refusing a
 * request", "it will be opt-in") is fine; claiming it *does* is not.
 */
test("an unshipped stage's copy contains no present-tense capability claim", () => {
  const claims =
    /\b(blocks|refuses|protects|prevents|stops|enforces|defends|intercepts|shields|quarantines|rate-limits|lets you|gives you|you can|available now)\b/i;
  for (const stage of NEXT_STAGES) {
    for (const text of [stage.tagline, stage.body, stage.caveat ?? ""]) {
      assert.doesNotMatch(text, claims, `${stage.name}: "${text}"`);
    }
  }
});

test("only a shipped stage can offer somewhere to go", () => {
  for (const stage of NEXT_STAGES) {
    assert.equal(stage.href, undefined, `${stage.name} has no call to action`);
  }
});

/**
 * Each shipped stage points at something real. The two whose coverage is
 * narrower than the headline suggests have to say so on the page itself: the
 * extension isn't distributed through the Chrome Web Store yet, and agent
 * traffic on a site's own pages needs a collector that isn't generally
 * available (see the GDPR/DPA gate in CLAUDE.md).
 */
test("shipped stages that are narrower than they sound carry their limit", () => {
  const byName = new Map(STAGES.map((stage) => [stage.name, stage]));
  assert.match(byName.get("Detection")!.caveat ?? "", /Chrome Web Store/i);
  assert.match(byName.get("Identity")!.caveat ?? "", /collector|limited release/i);
  assert.ok(byName.get("Authorization")!.caveat, "Authorization states its coverage too");
});

/**
 * CLAUDE.md, "What TrustTab is NOT": it is not an agent-identity or payments
 * protocol, and user-facing copy must not drift into positioning it as one. A
 * stage called Identity is exactly where that would happen.
 */
test("the Identity stage disclaims being an identity or payments product", () => {
  const identity = STAGES.find((stage) => stage.name === "Identity")!;
  assert.match(identity.body, /doesn't issue agent identity|does not issue agent identity/i);
  assert.match(identity.body, /authorize transactions/i);
});

/** Estimates are labelled as estimates everywhere else in the product, including here. */
test("the Detection stage calls its estimates estimates", () => {
  const detection = STAGES.find((stage) => stage.name === "Detection")!;
  assert.match(detection.body, /estimate/i);
});

/** Self-declared is never presented as verified, on this page either. */
test("the Verification stage keeps Self-declared distinct from Verified", () => {
  const verification = STAGES.find((stage) => stage.name === "Verification")!;
  assert.match(verification.body, /Self-declared — never Verified/);
});
