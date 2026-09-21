import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TRACKING_CAVEAT, TRACKING_CONTEXT, TRACKING_SIGNATURES } from "./tracking-signatures";
import { describeTracking, detectTracking } from "./tracking";
import { WIDGET_SIGNATURES } from "./widget-signatures";
import type { PageEvidence } from "./widgets";

const evidence = (hosts: string[]): PageEvidence => ({ pageHost: "example.com", hosts, matchedSelectors: [] });

test("a known host is reported, with the host as the evidence", () => {
  const found = detectTracking(evidence(["www.google-analytics.com"]));
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "Google Analytics");
  assert.deepEqual(found[0].evidence, ["loads from google-analytics.com"]);
});

test("subdomains match, unrelated hosts don't", () => {
  assert.equal(detectTracking(evidence(["static.hotjar.com"])).length, 1);
  assert.equal(detectTracking(evidence(["cdn.example.com", "fonts.googleapis.com"])).length, 0);
  // A host that merely contains a signature host as a substring must not match.
  assert.equal(detectTracking(evidence(["not-hotjar.com.evil.test"])).length, 0);
});

/**
 * The lesson from 2a's false positives, applied before it became a repeat bug:
 * a container tells you a container is installed and nothing about its
 * contents.
 */
describe("Google Tag Manager is not Google Analytics", () => {
  test("GTM alone reports a tag manager, never analytics", () => {
    const found = detectTracking(evidence(["www.googletagmanager.com"]));
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, "tag_manager");
    assert.doesNotMatch(found[0].name, /Analytics/);
    assert.match(found[0].note ?? "", /doesn't show which analytics/i);
  });

  test("GA is only reported when its own host is loaded", () => {
    const both = detectTracking(evidence(["www.googletagmanager.com", "www.google-analytics.com"]));
    assert.deepEqual(both.map((d) => d.id).sort(), ["google-analytics", "google-tag"]);
  });
});

test("the sentence names what was found and nothing more", () => {
  const one = describeTracking(detectTracking(evidence(["static.hotjar.com"])));
  assert.equal(one, "This page loads tracking from: Hotjar.");
  const many = describeTracking(detectTracking(evidence(["static.hotjar.com", "cdn.segment.com"])));
  assert.match(many ?? "", /^This page loads tracking from: .* and .*\.$/);
  assert.equal(describeTracking([]), null);
});

test("nothing in the output characterises the site", () => {
  const forbidden = /\b(spy|spying|invasive|violat\w+|creepy|malicious|suspicious|danger\w*)\b/i;
  const all = [
    ...TRACKING_SIGNATURES.flatMap((s) => [s.name, s.note ?? ""]),
    TRACKING_CAVEAT,
    TRACKING_CONTEXT,
    describeTracking(detectTracking(evidence(["static.hotjar.com"]))) ?? "",
  ];
  for (const text of all) assert.doesNotMatch(text, forbidden, text);
});

test("the context line says plainly that this is not a concern", () => {
  assert.match(TRACKING_CONTEXT, /not because it's a problem/i);
  assert.match(TRACKING_CAVEAT, /doesn't mean a page isn't tracking you/i);
});

/** One installation must never be reported twice, in two different sections. */
test("no host is shared with the widget signature list", () => {
  const widgetHosts = new Set(WIDGET_SIGNATURES.flatMap((s) => s.hosts));
  for (const signature of TRACKING_SIGNATURES) {
    for (const host of signature.hosts) {
      assert.ok(!widgetHosts.has(host), `${host} appears in both lists`);
    }
  }
});

test("every signature is specific enough to name a product", () => {
  const ids = new Set<string>();
  for (const signature of TRACKING_SIGNATURES) {
    assert.ok(!ids.has(signature.id), `duplicate id ${signature.id}`);
    ids.add(signature.id);
    assert.ok(signature.hosts.length > 0, `${signature.id} has hosts`);
    for (const host of signature.hosts) {
      assert.match(host, /^[a-z0-9.-]+\.[a-z]{2,}$/, `${signature.id}: ${host} is a bare host`);
      assert.ok(!["com", "net", "io", "googleapis.com", "cloudfront.net"].includes(host), `${signature.id}: ${host} is too generic`);
    }
  }
});
