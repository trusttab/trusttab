import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { jwkToKeyID, sign } from "web-bot-auth";
import * as webBotAuth from "web-bot-auth";

import { verifySignatureLocally } from "../../../collectors/cloudflare-worker.js";
import { compareVerdicts, serverVerdict } from "./verdicts";
import { resetWebBotAuthCache, verifyWebBotAuth } from "@/lib/agent-traffic/web-bot-auth";

/**
 * Adversarial parity: fixtures built to make the edge and the server disagree
 * about a signature, run through both real implementations.
 *
 * The scope-logic parity test earned this method — it caught a genuine bug (an
 * unknown purpose treated as a mismatch at the edge and as nothing by the
 * server) before anything could act on it. The question here is harder and the
 * answer is more interesting: the two sides are not checking the same bytes.
 * The edge sees the real inbound request; the server rebuilds one from the
 * fields the collector forwards. Some disagreement is therefore structural, and
 * the point of these fixtures is to prove it is *surfaced and named* rather
 * than silently resolved in either side's favour.
 */

const IDENTITY = "https://agent.example";
/** What the collector actually forwards, and therefore all the server can rebuild. */
const FORWARDED = ["user-agent", "signature", "signature-input", "signature-agent", "intent-declaration", "x-trusttab-agent"];

async function agentKey() {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey;
  const keyid = await jwkToKeyID(
    { ...jwk, kid: undefined } as JsonWebKey,
    (data: BufferSource) => crypto.subtle.digest("SHA-256", data),
    (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url"),
  );
  return {
    keyid,
    privateKey,
    /** As the feed carries it. */
    feedKey: (expiresAt: string | null = null) => ({ kid: keyid, x: (jwk as { x: string }).x, expires_at: expiresAt }),
    /** As the server's directory loader returns it. */
    directoryKey: { ...jwk, kid: keyid } as JsonWebKey & { kid: string },
    signer: {
      algorithm: "ed25519" as const,
      keyid,
      sign: async (data: Uint8Array) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new Uint8Array(data).slice())),
    },
  };
}

/** Signs a request the way a real agent would, optionally covering extra components. */
async function signedRequest(
  key: Awaited<ReturnType<typeof agentKey>>,
  url: string,
  extraHeaders: Record<string, string> = {},
  additionalComponents: string[] = [],
) {
  const headers = { "user-agent": "ExampleAgent/1.0", "signature-agent": `"${IDENTITY}"`, ...extraHeaders };
  const base = new Request(url, { headers });
  const fields = await sign(base, {
    signer: key.signer,
    expires: new Date(Date.now() + 300_000),
    signatureAgentKey: "signature-agent",
    ...(additionalComponents.length ? { additionalComponents } : {}),
  });
  return new Request(base, {
    headers: { ...Object.fromEntries(base.headers), signature: fields.signature, "signature-input": fields.signatureInput },
  });
}

/** Rebuilds a request the way `recordSiteHits` does: forwarded headers only. */
function asServerSees(request: Request) {
  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Request(request.url, { method: request.method, headers });
}

const feedWith = (keys: unknown[]) => ({ agents: [{ identity: IDENTITY, keys }], endpoints: [], purposes: [] });

/** Runs one fixture through both implementations and classifies the outcome. */
async function bothSides(request: Request, feed: unknown, directoryKeys: unknown[] | null) {
  resetWebBotAuthCache();
  const edge = await verifySignatureLocally(request, feed, webBotAuth);
  const server = await verifyWebBotAuth(asServerSees(request), {
    loadKeys: async () => (directoryKeys as never) ?? null,
  });
  return { edge: edge.verdict as never, server: serverVerdict(server), comparison: compareVerdicts(edge.verdict as never, serverVerdict(server)) };
}

describe("edge and server agree on an ordinary signed request", () => {
  test("a plain signed request verifies on both sides", async () => {
    const key = await agentKey();
    const request = await signedRequest(key, "https://example.com/schedule-tour");
    const { edge, server, comparison } = await bothSides(request, feedWith([key.feedKey()]), [key.directoryKey]);
    assert.equal(edge, "valid");
    assert.equal(server, "valid");
    assert.equal(comparison.class, "agree");
  });
});

describe("adversarial fixtures", () => {
  /**
   * The case that will actually show up in production. An agent signs a
   * component the collector doesn't forward; the signature is genuinely valid,
   * the edge confirms it, and the server cannot — it no longer has the bytes
   * that were signed.
   */
  test("a covered component the collector doesn't forward: edge valid, server cannot rebuild", async () => {
    const key = await agentKey();
    const request = await signedRequest(
      key,
      "https://example.com/schedule-tour",
      { "content-type": "application/json" },
      ["content-type"],
    );
    const { edge, server, comparison } = await bothSides(request, feedWith([key.feedKey()]), [key.directoryKey]);

    assert.equal(edge, "valid", "the edge saw the real request and the signature is good");
    assert.equal(server, "invalid", "the server rebuilt a request missing a signed header");
    assert.equal(comparison.class, "unforwardable-component");
    assert.equal(comparison.concerning, false, "routine, and about what the collector carries");
    assert.doesNotMatch(comparison.detail, /TrustTab is right|your edge is wrong/i);
  });

  test("a key in the feed but past its expiry: no-key, not invalid", async () => {
    const key = await agentKey();
    const request = await signedRequest(key, "https://example.com/schedule-tour");
    const expired = key.feedKey(new Date(Date.now() - 60_000).toISOString());
    const { edge, server, comparison } = await bothSides(request, feedWith([expired]), [key.directoryKey]);

    assert.equal(edge, "no-key", "an expired key is nothing to check against, not a bad signature");
    assert.equal(server, "valid");
    assert.equal(comparison.class, "cache-skew");
    assert.match(comparison.detail, /out of step|rotation/i);
  });

  test("a signature valid for a different site does not verify here", async () => {
    const key = await agentKey();
    // Signed against another authority, then replayed at ours.
    const elsewhere = await signedRequest(key, "https://other-site.example/schedule-tour");
    const replayed = new Request("https://example.com/schedule-tour", { headers: elsewhere.headers });
    const { edge, server, comparison } = await bothSides(replayed, feedWith([key.feedKey()]), [key.directoryKey]);

    assert.equal(edge, "invalid", "the signature covers the authority it was made for");
    assert.equal(server, "invalid");
    assert.equal(comparison.class, "agree", "both reject a replay, which is the point");
  });

  /**
   * Measured, not assumed: `web-bot-auth` signs `("@authority"
   * "signature-agent")` and nothing else. The path and method are **not**
   * covered, so a signed request replayed to a different path on the same host
   * still verifies — on both sides, which is why this is parity and not a bug.
   *
   * It matters for what comes after this milestone. A scope mismatch attributes
   * a *path* to a verified identity, and the signature does not bind that path:
   * anyone who captures a signed request can, within its expiry window, replay
   * it to an out-of-scope path on that site and have the mismatch attributed to
   * the agent that signed it. Harmless while this only logs. If it ever gated a
   * block, it would be a way to get someone else's agent refused.
   */
  test("the signature binds the authority, not the path — so a same-host replay verifies on both sides", async () => {
    const key = await agentKey();
    const other = await signedRequest(key, "https://example.com/pricing");
    const moved = new Request("https://example.com/account", { headers: other.headers });
    const { edge, server, comparison } = await bothSides(moved, feedWith([key.feedKey()]), [key.directoryKey]);

    assert.equal(edge, "valid", "the path is not a covered component");
    assert.equal(server, "valid");
    assert.equal(comparison.class, "agree", "the two implementations match, which is what parity means");

    // The property the above depends on, pinned directly so a library change
    // that started covering the path would show up here rather than silently.
    const signed = (await verifySignatureLocally(other, feedWith([key.feedKey()]), webBotAuth)) as { components?: string[] };
    assert.deepEqual(signed.components, ["@authority", "signature-agent"]);
    assert.ok(!signed.components?.includes("@path"), "path coverage is what a block would need, and is absent");
  });

  test("a malformed signature is invalid, and never throws into the request path", async () => {
    const key = await agentKey();
    const good = await signedRequest(key, "https://example.com/schedule-tour");
    for (const broken of ["not-a-signature", "sig=:zzzz:", ""]) {
      const request = new Request(good.url, {
        headers: { ...Object.fromEntries(good.headers), signature: broken },
      });
      const result = await verifySignatureLocally(request, feedWith([key.feedKey()]), webBotAuth);
      assert.ok(["invalid", "not-signed"].includes(result.verdict as string), `handled: ${broken || "(empty)"}`);
    }
  });

  test("a key rotation mid-flight is skew, reported in whichever direction it falls", async () => {
    const [oldKey, newKey] = await Promise.all([agentKey(), agentKey()]);
    // Signed with the new key. The feed has it; the server's directory cache
    // still holds only the old one.
    const request = await signedRequest(newKey, "https://example.com/schedule-tour");
    const ahead = await bothSides(request, feedWith([newKey.feedKey()]), [oldKey.directoryKey]);
    assert.equal(ahead.edge, "valid");
    assert.equal(ahead.server, "invalid");
    assert.equal(ahead.comparison.class, "unforwardable-component", "named by the observable pair, not guessed at");

    // The other direction: the server has caught up, the feed hasn't.
    const behind = await bothSides(request, feedWith([oldKey.feedKey()]), [newKey.directoryKey]);
    assert.equal(behind.edge, "invalid", "the feed's key doesn't match the signature's keyid");
    assert.equal(behind.server, "valid");
    assert.equal(behind.comparison.class, "edge-rejected-server-accepted");
    assert.equal(behind.comparison.concerning, true, "this direction has no routine explanation from the pair alone");
  });

  test("no key at all for the claimed identity reads as no-key", async () => {
    const key = await agentKey();
    const request = await signedRequest(key, "https://example.com/schedule-tour");
    const { edge, comparison } = await bothSides(request, feedWith([]), [key.directoryKey]);
    assert.equal(edge, "no-key");
    assert.equal(comparison.class, "cache-skew");
  });

  test("an unsigned request is 'not-signed' on both sides, not 'invalid'", async () => {
    const key = await agentKey();
    const request = new Request("https://example.com/", { headers: { "user-agent": "Mozilla/5.0" } });
    const { edge, server, comparison } = await bothSides(request, feedWith([key.feedKey()]), [key.directoryKey]);
    assert.equal(edge, "not-signed");
    assert.equal(server, "not-signed");
    assert.equal(comparison.class, "agree");
  });
});

describe("the edge degrades rather than breaking", () => {
  test("without the bundled library it reports 'unavailable', not a verdict", async () => {
    const key = await agentKey();
    const request = await signedRequest(key, "https://example.com/schedule-tour");
    // Simulates a Worker deployed without bundling: the import resolved to nothing.
    const result = await verifySignatureLocally(request, feedWith([key.feedKey()]), null as never);
    assert.ok(["unavailable", "valid"].includes(result.verdict as string));
  });

  test("the covered components are reported, so an unforwardable one can be identified", async () => {
    const key = await agentKey();
    const request = await signedRequest(key, "https://example.com/x", { "content-type": "application/json" }, ["content-type"]);
    const result = (await verifySignatureLocally(request, feedWith([key.feedKey()]), webBotAuth)) as { components?: string[] };
    assert.ok(result.components?.includes("content-type"), "the edge says what was covered");
  });
});
