import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENT_CHECK_REASONS, agentCheckBody } from "./agent-check";
import type { WebBotAuthResult } from "./web-bot-auth";

const verified: WebBotAuthResult = {
  ok: true,
  identity: "https://youragent.example",
  keyid: "key-1",
  expires: new Date("2026-09-19T12:00:00Z"),
  declaration: null,
  components: ["@authority", "signature-agent"],
};

test("a verified check reports the identity and what the signature actually covered", () => {
  const body = agentCheckBody(verified);
  assert.equal(body.verified, true);
  assert.equal(body.identity, "https://youragent.example");
  assert.deepEqual(body.covered_components, ["@authority", "signature-agent"]);
  assert.equal(body.signature_expires, "2026-09-19T12:00:00.000Z");
  assert.equal(body.declared_intent, null);
});

test("a signed declaration is reported; the covered-components rule is the verifier's job", () => {
  const body = agentCheckBody({
    ...verified,
    declaration: { purposes: ["booking"], scopes: ["/schedule-tour"] },
    components: ["@authority", "signature-agent", "intent-declaration"],
  });
  assert.deepEqual(body.declared_intent, { purposes: ["booking"], scopes: ["/schedule-tour"] });
  assert.ok((body.covered_components as string[]).includes("intent-declaration"));
});

test("every failure explains itself and says what to look at", () => {
  for (const reason of Object.keys(AGENT_CHECK_REASONS) as (keyof typeof AGENT_CHECK_REASONS)[]) {
    const body = agentCheckBody({ ok: false, reason });
    assert.equal(body.verified, false);
    assert.equal(body.reason, reason);
    assert.ok(String(body.summary).length > 20, `${reason} has a summary`);
    assert.ok(String(body.what_to_check).length > 20, `${reason} says what to check`);
  }
});

test("the budget failure says it is our limit, not the operator's mistake", () => {
  const body = agentCheckBody({ ok: false, reason: "budget" });
  assert.match(String(body.what_to_check), /limit on our side, not a problem with your setup/i);
});

/**
 * The reason this endpoint is safe to offer publicly: it can't be mistaken for
 * a credential. Every response says so, on both branches.
 */
test("every response disclaims issuing identity", () => {
  const bodies = [
    agentCheckBody(verified),
    ...(Object.keys(AGENT_CHECK_REASONS) as (keyof typeof AGENT_CHECK_REASONS)[]).map((reason) =>
      agentCheckBody({ ok: false, reason }),
    ),
  ];
  for (const body of bodies) {
    assert.match(String(body.note), /does not issue identity/i, "the disclaimer is on every response");
  }
  assert.match(String(agentCheckBody(verified).note), /says nothing about how your agent behaves/i);
});

test("nothing in the response reads as a credential the operator now holds", () => {
  const body = agentCheckBody(verified);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /\b(token|certificate|credential|approved|trusted by|issued|badge)\b/i);
});
