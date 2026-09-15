import assert from "node:assert/strict";
import { test } from "node:test";

import { AI_ARTIFACT_PATTERNS, matchArtifactPattern } from "./artifacts";

test("chatbot leftovers and placeholders match", () => {
  const cases: [string, string][] = [
    ["As an AI language model, I can't", "as-an-ai"],
    ["I'm an AI and don't have opinions", "i-am-an-ai"],
    ["as of my last knowledge cutoff", "knowledge-cutoff"],
    ["Certainly! Here is", "chatbot-opener"],
    ["Sure, here's", "chatbot-opener"],
    ["Here is a 250-word blog post", "here-is-your-text"],
    ["Here's a revised version", "here-is-your-text"],
    ["I hope this helps!", "hope-this-helps"],
    ["Let me know if you'd like me to adjust", "let-me-know"],
    ["Call [Company Name] today", "placeholder"],
    ["[insert statistic here]", "placeholder"],
    ["Regenerate response", "regenerate"],
  ];
  for (const [quote, id] of cases) assert.equal(matchArtifactPattern(quote), id, quote);
});

// Regressions from live tests: phrases Haiku offered as "artifacts" that people write too.
test("style, vocabulary and ordinary copy never match", () => {
  for (const quote of [
    "fast-paced digital landscape",
    "transformative shift that is reshaping",
    "cornerstone of any successful remote team",
    "Prepare to be impressed",
    "seamless experience",
    "In conclusion, remote work presents both challenges and opportunities",
    "Here is our menu",
    "Here's what our customers say",
    "Let me know what you think",
    "[1]",
    "[ 44 ]",
    "Terms [PDF]",
  ]) {
    assert.equal(matchArtifactPattern(quote), null, quote);
  }
});

test("ids are unique", () => {
  const ids = AI_ARTIFACT_PATTERNS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
