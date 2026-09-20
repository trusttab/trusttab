import assert from "node:assert/strict";
import { test } from "node:test";

import { FEED_TTL_SECONDS, MAX_FEED_ENDPOINTS, buildEnforcementFeed, isFeedExpired } from "./feed";
import type { Purpose } from "@/lib/manifest/types";

const now = new Date("2026-09-20T12:00:00Z");
const feed = (over: Partial<Parameters<typeof buildEnforcementFeed>[0]> = {}) =>
  buildEnforcementFeed({
    issuer: "https://trusttab-mu.vercel.app",
    domain: "example.com",
    verificationId: "tt_example1",
    endpoints: [{ path: "/schedule-tour", purpose: "booking" as Purpose }],
    now,
    ...over,
  });

test("a feed expires within minutes of being issued", () => {
  const built = feed();
  const lifetime = (Date.parse(built.expires_at) - Date.parse(built.issued_at)) / 1000;
  assert.equal(lifetime, FEED_TTL_SECONDS);
  assert.ok(lifetime >= 60 && lifetime <= 600, "minutes, toward the shorter end");
});

/**
 * The property the whole architecture rests on: if TrustTab stops publishing,
 * the edge stops evaluating. A feed that outlived its expiry would mean
 * enforcement continuing unsupervised with no channel to correct it.
 */
test("an expired feed is unusable, and so is anything undated or unparseable", () => {
  const built = feed();
  assert.equal(isFeedExpired(built, new Date(Date.parse(built.expires_at) - 1000)), false);
  assert.equal(isFeedExpired(built, new Date(Date.parse(built.expires_at))), true, "expiry is not a grace period");
  assert.equal(isFeedExpired(built, new Date(Date.parse(built.expires_at) + 1000)), true);

  for (const bad of [{}, { expires_at: null }, { expires_at: "soon" }, { expires_at: 12345 }]) {
    assert.equal(isFeedExpired(bad as { expires_at?: unknown }, now), true, `unusable: ${JSON.stringify(bad)}`);
  }
});

test("the only mode a feed can carry is observe", () => {
  assert.equal(feed().mode, "observe");
});

/**
 * Blocking is a separate milestone that begins only after the owner has signed
 * off on observe-only evidence from real traffic. Until then no feed, and no
 * code reading one, may express a block.
 */
test("nothing in a feed can express blocking", () => {
  const serialized = JSON.stringify(feed());
  assert.doesNotMatch(serialized, /\b(block|deny|reject|challenge|enforce)\w*\b/i);
});

test("endpoints are sorted, so an unchanged site produces a stable document", () => {
  const endpoints = [
    { path: "/quote", purpose: "quote_request" as Purpose },
    { path: "/contact", purpose: "lead_inquiry" as Purpose },
    { path: "/contact", purpose: "booking" as Purpose },
  ];
  const a = feed({ endpoints });
  const b = feed({ endpoints: endpoints.slice().reverse() });
  assert.deepEqual(a.endpoints, b.endpoints);
  assert.deepEqual(
    a.endpoints.map((e) => `${e.path} ${e.purpose}`),
    ["/contact booking", "/contact lead_inquiry", "/quote quote_request"],
  );
});

test("a site cannot publish an unbounded feed", () => {
  const many = Array.from({ length: MAX_FEED_ENDPOINTS + 25 }, (_, i) => ({
    path: `/p${String(i).padStart(3, "0")}`,
    purpose: "booking" as Purpose,
  }));
  assert.equal(feed({ endpoints: many }).endpoints.length, MAX_FEED_ENDPOINTS);
});

test("a feed names the issuer and the site it is for", () => {
  const built = feed();
  assert.equal(built.issuer, "https://trusttab-mu.vercel.app");
  assert.equal(built.site.domain, "example.com");
  assert.equal(built.site.verification_id, "tt_example1");
});
