import assert from "node:assert/strict";
import { test } from "node:test";

import { stageTreatment } from "./stage-style";
import { NEXT_STAGES, SHIPPED_STAGES } from "./stages";

const shipped = stageTreatment(true);
const notBuilt = stageTreatment(false);

/**
 * The gap this closes: `stages.test.ts` pins the data partition and that the
 * page renders the groups separately, but not that they *look* different. A
 * visual pass could render five identical cards from two arrays and pass every
 * test. These assertions are what make the distinction survive a restyle.
 */

test("only a shipped stage is drawn as a card", () => {
  assert.equal(shipped.isCard, true);
  assert.equal(notBuilt.isCard, false);
});

test("the unshipped treatment has no card surface or border of its own", () => {
  assert.match(shipped.container, /\bbg-white\b/, "shipped sits on a card surface");
  assert.match(shipped.container, /\bborder\b/, "shipped has a full border");
  assert.doesNotMatch(notBuilt.container, /\bbg-(white|zinc-50)\b/, "unshipped has no card fill");
  assert.doesNotMatch(notBuilt.container, /\brounded-(lg|xl|md)\b/, "unshipped is not a rounded card");
  // A dashed edge rather than a solid one: the shape itself says "not finished".
  assert.match(notBuilt.container, /border-dashed/);
});

test("the two treatments are not interchangeable", () => {
  assert.notEqual(shipped.container, notBuilt.container);
  assert.notEqual(shipped.heading, notBuilt.heading);
  assert.notEqual(shipped.body, notBuilt.body);
});

test("an unshipped stage can never carry a call to action", () => {
  assert.equal(notBuilt.allowsCallToAction, false);
  assert.equal(shipped.allowsCallToAction, true);
});

/**
 * The treatments are written for their backgrounds: shipped stages sit on the
 * page's light ground, the unshipped one on the dark "What's next" section. A
 * light-on-light or dark-on-dark mistake here would make one of them
 * unreadable, which is its own way of losing the distinction.
 */
test("each treatment's text is written for the ground it sits on", () => {
  assert.match(shipped.heading, /text-zinc-900/, "dark text on the light card");
  assert.match(shipped.body, /text-zinc-600/);
  assert.match(notBuilt.heading, /text-zinc-100/, "light text on the dark section");
  assert.match(notBuilt.body, /text-zinc-400/);
});

/** The treatment is chosen by the flag, not by position or by hand at each call site. */
test("every stage's treatment follows from its shipped flag", () => {
  for (const stage of SHIPPED_STAGES) {
    assert.equal(stageTreatment(stage.shipped).isCard, true, `${stage.name} draws as a card`);
  }
  for (const stage of NEXT_STAGES) {
    assert.equal(stageTreatment(stage.shipped).isCard, false, `${stage.name} does not draw as a card`);
    assert.equal(stageTreatment(stage.shipped).allowsCallToAction, false);
  }
});
