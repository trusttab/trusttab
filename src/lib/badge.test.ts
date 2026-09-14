import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { renderBadge } from "./badge";

describe("renderBadge", () => {
  test("renders status text and a title for accessibility", () => {
    const svg = renderBadge("TrustTab", "verified");
    assert.match(svg, /^<svg /);
    assert.match(svg, /<title>TrustTab: verified<\/title>/);
    assert.match(svg, /#15803d/);
  });
  test("escapes the issuer label", () => {
    const svg = renderBadge(`<script>"x"&`, "failed");
    assert.doesNotMatch(svg, /<script>/);
    assert.match(svg, /&lt;script&gt;&quot;x&quot;&amp;/);
  });
  test("every status renders", () => {
    for (const s of ["verified", "pending", "needs_fix", "failed", "expired", "not_found"] as const) {
      assert.match(renderBadge("TrustTab", s), /<\/svg>$/);
    }
  });
});
