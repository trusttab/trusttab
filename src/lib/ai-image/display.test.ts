import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  applyArtifactRule,
  describeImageEstimate,
  IMAGE_ASSESSMENTS,
  IMAGE_ESTIMATE_LABELS,
  parseImageEstimateResponse,
  VISUAL_ARTIFACTS,
  type ImageEstimateOutcome,
} from "./display";

describe("image estimate labels", () => {
  test("every model result says estimate and no verified metadata, and never 'real'", () => {
    assert.deepEqual(IMAGE_ESTIMATE_LABELS, {
      possibly_ai: "Possibly AI-generated (estimate, no verified metadata found)",
      no_clear_signs: "No clear signs of AI generation (estimate, no verified metadata found)",
    });
    for (const assessment of IMAGE_ASSESSMENTS) {
      const response = applyArtifactRule(assessment, [{ type: "garbled_text", where: "shop sign" }]);
      const display = describeImageEstimate({ kind: "response", response });
      assert.equal(display.tone, "estimate");
      assert.match(display.title, /\(estimate, no verified metadata found\)$/);
      assert.ok(display.details.some((d) => /often wrong/.test(d)));
      // The label itself never vouches (the details only say what an estimate *doesn't* show).
      assert.doesNotMatch(display.title, /real|authentic|genuine|unedited/i);
    }
  });

  test("possibly_ai shows the artifacts to look for; no_clear_signs says it isn't proof of a real image", () => {
    const ai = describeImageEstimate({ kind: "response", response: applyArtifactRule("possibly_ai", [{ type: "malformed_anatomy", where: "left hand" }]) });
    assert.deepEqual(ai.artifacts, [`${VISUAL_ARTIFACTS.malformed_anatomy.label}: left hand`]);
    const clear = describeImageEstimate({ kind: "response", response: applyArtifactRule("no_clear_signs", []) });
    assert.deepEqual(clear.artifacts, []);
    assert.match(clear.details[0], /doesn't show the image is real/);
  });

  test("non-model outcomes are plain notices", () => {
    const outcomes: ImageEstimateOutcome[] = [{ kind: "rate_limited", retryAfterSeconds: 60 }, { kind: "unavailable" }, { kind: "unreadable" }, { kind: "error" }];
    for (const outcome of outcomes) {
      const display = describeImageEstimate(outcome);
      assert.equal(display.tone, "notice");
      assert.doesNotMatch(display.title, /AI-generated/);
    }
  });
});

/**
 * Pins the bias in code: "Possibly AI-generated" needs a listed, concrete
 * artifact. Style-only answers and unknown artifact types become
 * no_clear_signs. If this fails, restore the rule; don't loosen the test.
 */
describe("possibly_ai needs a listed artifact", () => {
  test("no artifacts, or only unlisted ones, becomes no_clear_signs", () => {
    assert.deepEqual(applyArtifactRule("possibly_ai", []), { result: "estimate", assessment: "no_clear_signs", artifacts: [] });
    assert.deepEqual(parseImageEstimateResponse({ result: "estimate", assessment: "possibly_ai", artifacts: [{ type: "too_smooth", where: "skin" }, { type: "unusual_lighting" }] }), {
      result: "estimate",
      assessment: "no_clear_signs",
      artifacts: [],
    });
  });

  test("a listed artifact keeps possibly_ai; artifacts are never attached to no_clear_signs", () => {
    assert.equal(parseImageEstimateResponse({ result: "estimate", assessment: "possibly_ai", artifacts: [{ type: "garbled_text", where: "  on the\nsign " }] })?.assessment, "possibly_ai");
    assert.deepEqual(parseImageEstimateResponse({ result: "estimate", assessment: "possibly_ai", artifacts: [{ type: "garbled_text", where: "  on the\nsign " }] })?.artifacts, [{ type: "garbled_text", where: "on the sign" }]);
    assert.deepEqual(applyArtifactRule("no_clear_signs", [{ type: "garbled_text", where: "x" }]).artifacts, []);
  });

  test("long locations are cut at a word boundary", () => {
    const [artifact] = parseImageEstimateResponse({
      result: "estimate",
      assessment: "possibly_ai",
      artifacts: [{ type: "impossible_geometry", where: "The large sphere in the center - puzzle pieces don't form a coherent 3D sphere surface" }],
    })!.artifacts;
    assert.ok(artifact.where.length <= 80);
    assert.match(artifact.where, /\S…$/);
    assert.doesNotMatch(artifact.where, / s…$/);
  });

  test("malformed responses are rejected", () => {
    assert.equal(parseImageEstimateResponse({ result: "estimate", assessment: "real" }), null);
    assert.equal(parseImageEstimateResponse(null), null);
  });
});
