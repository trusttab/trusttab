import assert from "node:assert/strict";
import { test } from "node:test";

import { compareVerdicts, serverVerdict, type Verdict } from "./verdicts";

const VERDICTS: Verdict[] = ["valid", "invalid", "no-key", "not-signed"];

test("the server's richer result maps onto the shared vocabulary", () => {
  assert.equal(serverVerdict({ ok: true, identity: "https://a", keyid: "k", expires: new Date(), declaration: null, components: [] }), "valid");
  assert.equal(serverVerdict({ ok: false, reason: "not-signed" }), "not-signed");
  assert.equal(serverVerdict({ ok: false, reason: "no-agent" }), "not-signed");
  assert.equal(serverVerdict({ ok: false, reason: "unverified" }), "invalid");
  // Neither of these is a judgment about the signature: they mean "no keys".
  assert.equal(serverVerdict({ ok: false, reason: "directory-unavailable" }), "no-key");
  assert.equal(serverVerdict({ ok: false, reason: "budget" }), "no-key");
});

test("agreement is agreement, whatever the two agreed on", () => {
  for (const verdict of VERDICTS) {
    const comparison = compareVerdicts(verdict, verdict);
    assert.equal(comparison.class, "agree");
    assert.equal(comparison.concerning, false);
  }
});

/**
 * Finding 1, and the reason the panel had to be reworded. Before the edge could
 * verify, "TrustTab is right" was true. Here it is false: TrustTab verifies a
 * reconstruction and the edge saw the real request, so this combination is the
 * expected result for an agent signing components the collector doesn't forward.
 */
test("edge valid + server invalid is named as a collector limitation, not a fault", () => {
  const comparison = compareVerdicts("valid", "invalid");
  assert.equal(comparison.class, "unforwardable-component");
  assert.equal(comparison.concerning, false);
  assert.match(comparison.detail, /forwards/i, "it explains why, in terms of what we carry");
  assert.match(comparison.detail, /not the agent and not your edge/i);
});

test("the two caches being out of step is routine, in either direction", () => {
  for (const [edge, server] of [["valid", "no-key"], ["no-key", "valid"]] as [Verdict, Verdict][]) {
    const comparison = compareVerdicts(edge, server);
    assert.equal(comparison.class, "cache-skew");
    assert.equal(comparison.concerning, false);
    assert.match(comparison.detail, /six hours|rotation/i);
  }
});

test("a feed without a key says so, rather than implying the signature was bad", () => {
  const comparison = compareVerdicts("no-key", "invalid");
  assert.equal(comparison.class, "feed-missing-key");
  assert.equal(comparison.concerning, false);
  assert.match(comparison.detail, /not a judgment about the signature/i);
});

/** The one combination with no ordinary explanation. */
test("edge invalid + server valid is the only routine-free class, and is flagged", () => {
  const comparison = compareVerdicts("invalid", "valid");
  assert.equal(comparison.class, "edge-rejected-server-accepted");
  assert.equal(comparison.concerning, true);
  assert.match(comparison.detail, /no ordinary explanation/i);
});

/**
 * The property the owner asked for: name which disagreement it is, never
 * declare which side is correct.
 */
test("no comparison declares a winner", () => {
  const forbidden = /\b(TrustTab is right|the server is right|your edge is (right|wrong)|correct verdict|authoritative)\b/i;
  for (const edge of VERDICTS) {
    for (const server of VERDICTS) {
      const comparison = compareVerdicts(edge, server);
      for (const text of [comparison.title, comparison.detail]) {
        assert.doesNotMatch(text, forbidden, `${edge} vs ${server}: "${text}"`);
      }
    }
  }
});

test("every combination is classified and explained", () => {
  for (const edge of VERDICTS) {
    for (const server of VERDICTS) {
      const comparison = compareVerdicts(edge, server);
      assert.ok(comparison.title.length > 10, `${edge}/${server} has a title`);
      assert.ok(comparison.detail.length > 40, `${edge}/${server} is explained`);
      assert.equal(comparison.edge, edge);
      assert.equal(comparison.server, server);
    }
  }
});

/** Only the classes a person should act on ask for attention. */
test("concern is reserved for the classes that have no routine cause", () => {
  const concerning = VERDICTS.flatMap((edge) => VERDICTS.map((server) => compareVerdicts(edge, server))).filter(
    (c) => c.concerning,
  );
  for (const c of concerning) {
    assert.ok(
      c.class === "edge-rejected-server-accepted" || c.class === "unclassified",
      `${c.edge}/${c.server} classed ${c.class} should not be concerning`,
    );
  }
});
