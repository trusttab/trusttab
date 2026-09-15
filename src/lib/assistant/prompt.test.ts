import assert from "node:assert/strict";
import { test } from "node:test";

import { SYSTEM_PROMPT } from "./prompt";

/**
 * Pins the rules that keep the assistant from steering owners away from
 * self-attestation when a form is JavaScript-rendered (see
 * jsRenderingEvidence), and from implying it can publish.
 */
test("the prompt biases ambiguous missing-form evidence toward JavaScript rendering", () => {
  assert.match(SYSTEM_PROMPT, /Never tell the owner the form is not built by JavaScript, and never say JavaScript rendering is ruled out/);
  assert.match(SYSTEM_PROMPT, /the two mistakes aren't equally bad/);
  assert.match(SYSTEM_PROMPT, /When the evidence is ambiguous, lean toward JavaScript rendering/);
  assert.match(SYSTEM_PROMPT, /Text found in the HTML doesn't rule it out either/);
  assert.doesNotMatch(SYSTEM_PROMPT, /looks_client_rendered/);
});

test("the prompt states the assistant cannot publish", () => {
  assert.match(SYSTEM_PROMPT, /You can NOT publish/);
  assert.match(SYSTEM_PROMPT, /Never say or imply that you published, signed or submitted anything/);
});
