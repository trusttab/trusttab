import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  countWords,
  describeTextEstimate,
  ESTIMATE_LABELS,
  MAX_CHARS,
  parseTextEstimateResponse,
  prepareText,
  TEXT_ASSESSMENTS,
  type TextEstimateOutcome,
} from "./display";

describe("estimate labels", () => {
  test("every model result is labeled an estimate", () => {
    for (const assessment of TEXT_ASSESSMENTS) {
      assert.match(ESTIMATE_LABELS[assessment], /\(estimate\)$/, assessment);
      const display = describeTextEstimate({
        kind: "response",
        response: { result: "estimate", assessment, rationale: "Because.", words_analyzed: 400 },
      });
      assert.equal(display.tone, "estimate");
      assert.match(display.title, /\(estimate\)/);
      assert.ok(display.details.some((d) => /often wrong/.test(d)), "caveat shown");
    }
    assert.deepEqual(ESTIMATE_LABELS, {
      likely_ai: "Likely AI-written (estimate)",
      unclear: "Can't tell (estimate)",
      likely_human: "Likely human-written (estimate)",
    });
  });

  test("non-model outcomes never look like an authorship judgment", () => {
    const outcomes: TextEstimateOutcome[] = [
      { kind: "response", response: { result: "not_enough_text", words_analyzed: 20 } },
      { kind: "too_short", words: 12 },
      { kind: "rate_limited", retryAfterSeconds: 1800 },
      { kind: "unavailable" },
      { kind: "cant_inspect" },
      { kind: "error" },
    ];
    for (const outcome of outcomes) {
      const display = describeTextEstimate(outcome);
      assert.equal(display.tone, "notice");
      assert.doesNotMatch(`${display.title} ${display.details.join(" ")}`, /AI-written|human-written/, outcome.kind);
    }
    assert.match(describeTextEstimate({ kind: "too_short", words: 12 }).details[0], /Nothing was sent/);
    assert.match(describeTextEstimate({ kind: "rate_limited", retryAfterSeconds: 1800 }).details[0], /about 30 minutes/);
  });
});

describe("parseTextEstimateResponse", () => {
  test("accepts valid responses and rejects anything else", () => {
    assert.deepEqual(parseTextEstimateResponse({ result: "estimate", assessment: "unclear", rationale: "Mixed.", words_analyzed: 300 }), {
      result: "estimate",
      assessment: "unclear",
      rationale: "Mixed.",
      words_analyzed: 300,
    });
    assert.equal(parseTextEstimateResponse({ result: "estimate", assessment: "ai", rationale: "x", words_analyzed: 1 }), null);
    assert.equal(parseTextEstimateResponse({ result: "estimate", assessment: "likely_ai", words_analyzed: 1 }), null);
    assert.equal(parseTextEstimateResponse({ error: "nope" }), null);
    assert.equal(parseTextEstimateResponse(null), null);
  });
});

describe("prepareText", () => {
  test("collapses whitespace and caps length at a word boundary", () => {
    assert.equal(prepareText("  a \t b\n\n\n c  "), "a b\nc");
    const long = "word ".repeat(5000);
    const prepared = prepareText(long);
    assert.ok(prepared.length <= MAX_CHARS);
    assert.ok(prepared.endsWith("word"));
    assert.equal(countWords("one two\nthree"), 3);
  });
});
