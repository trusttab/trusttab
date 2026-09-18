import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import { describe, test } from "node:test";

import { jwkToKeyID, sign } from "web-bot-auth";

import { classifyRequest } from "./classify";
import { AGENT_RANGES } from "./ip-match";
import type { DirectoryKey } from "./web-bot-auth";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const TARGET = "https://trusttab-mu.vercel.app/api/manifest/leasetab.com";

/** Builds a request signed the way a Web Bot Auth agent signs one, plus the keys it would publish. */
async function signedRequest(agentOrigin: string, target = TARGET, options: { declaration?: string; coverDeclaration?: boolean } = {}) {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicJwk = (await crypto.subtle.exportKey("jwk", publicKey)) as DirectoryKey;
  const keyid = await jwkToKeyID(
    { ...publicJwk, kid: undefined } as JsonWebKey,
    (data: BufferSource) => crypto.subtle.digest("SHA-256", data),
    (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url"),
  );

  const request = new Request(target, {
    headers: {
      "user-agent": "ExampleAgent/1.0",
      "signature-agent": `"${agentOrigin}"`,
      ...(options.declaration ? { "intent-declaration": options.declaration } : {}),
    },
  });
  const fields = await sign(request, {
    ...(options.declaration && options.coverDeclaration !== false ? { additionalComponents: ["intent-declaration"] } : {}),
    signer: {
      algorithm: "ed25519",
      keyid,
      sign: async (data: Uint8Array) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, data)),
    },
    expires: new Date(Date.now() + 300_000),
    signatureAgentKey: "signature-agent",
  });

  const signed = new Request(request, {
    headers: { ...Object.fromEntries(request.headers), signature: fields.signature, "signature-input": fields.signatureInput },
  });
  return { signed, keys: [{ ...publicJwk, kid: keyid }] as DirectoryKey[] };
}

const plain = (headers: Record<string, string>) => new Request(TARGET, { headers });

describe("classifyRequest, Tier 2 (estimates)", () => {
  test("TrustTab's own fetches are their own tier", async () => {
    const result = await classifyRequest(plain({ "user-agent": "TrustTabBot/0.1 (site ownership and agent-trust verification)" }), "203.0.113.9");
    assert.equal(result.tier, "trusttab");
  });

  test("a known agent user agent is likely_automated, with the user agent as the evidence", async () => {
    const result = await classifyRequest(plain({ "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" }), "203.0.113.9");
    assert.equal(result.tier, "likely_automated");
    assert.equal(result.identity, "GPTBot (OpenAI)");
    assert.match(result.signal ?? "", /user agent says GPTBot/);
  });

  test("an IP in a published operator range counts, even with a browser user agent", async () => {
    const [entry] = AGENT_RANGES;
    const address = entry.prefixes[0].split("/")[0];
    const result = await classifyRequest(plain({ "user-agent": BROWSER_UA }), address);
    assert.equal(result.tier, "likely_automated");
    assert.match(result.signal ?? "", new RegExp(`IP is in ${entry.operator}'s published`));
  });

  test("an ordinary browser request is unclassified, with no claim about it", async () => {
    const result = await classifyRequest(plain({ "user-agent": BROWSER_UA }), "203.0.113.9");
    assert.deepEqual(result, { tier: "unclassified", identity: null, signal: null });
  });

  test("a missing IP and missing user agent are handled", async () => {
    assert.equal((await classifyRequest(plain({}), null)).tier, "unclassified");
  });
});

describe("classifyRequest, Tier 1 (verified)", () => {
  test("a genuine signed request is verified, and names the agent's domain", async () => {
    const { signed, keys } = await signedRequest("https://agent.example.com");
    const result = await classifyRequest(signed, "203.0.113.9", { loadKeys: async () => keys });
    assert.equal(result.tier, "verified");
    assert.equal(result.identity, "https://agent.example.com");
    assert.match(result.signal ?? "", /verified against agent\.example\.com's published keys/);
  });

  test("a signature replayed against a different site does not verify", async () => {
    const { signed, keys } = await signedRequest("https://agent.example.com");
    const replayed = new Request("https://someone-else.example/api/manifest/x", { headers: signed.headers });
    const result = await classifyRequest(replayed, "203.0.113.9", { loadKeys: async () => keys });
    assert.equal(result.tier, "unclassified");
    assert.match(result.signal ?? "", /signature was present but could not be verified/);
  });

  test("a signature whose key isn't in the published directory does not verify", async () => {
    const { signed } = await signedRequest("https://agent.example.com");
    const other = await signedRequest("https://agent.example.com");
    const result = await classifyRequest(signed, "203.0.113.9", { loadKeys: async () => other.keys });
    assert.equal(result.tier, "unclassified");
    assert.match(result.signal ?? "", /could not be verified/);
  });

  test("an unreachable directory is not a verification, and not an accusation either", async () => {
    const { signed } = await signedRequest("https://agent.example.com");
    const result = await classifyRequest(signed, "203.0.113.9", { loadKeys: async () => null });
    assert.equal(result.tier, "unclassified");
    assert.match(result.signal ?? "", /could not be verified/);
  });

  test("a verified agent beats a heuristic match on the same request", async () => {
    const { signed, keys } = await signedRequest("https://agent.example.com");
    const withBotUa = new Request(signed, { headers: { ...Object.fromEntries(signed.headers), "user-agent": "GPTBot/1.2" } });
    const result = await classifyRequest(withBotUa, "203.0.113.9", { loadKeys: async () => keys });
    assert.equal(result.tier, "verified");
  });

  /**
   * A declaration is only believed when the signature covered it: anyone can
   * append a header to a request someone else signed. See intent.test.ts for
   * the tamper-evidence proof this relies on.
   */
  test("a signed declaration is recorded with the verified identity", async () => {
    const { signed, keys } = await signedRequest("https://agent.example.com", TARGET, {
      declaration: 'purpose="booking"; scope="/schedule-tour"',
    });
    const result = await classifyRequest(signed, "203.0.113.9", { loadKeys: async () => keys });
    assert.equal(result.tier, "verified");
    assert.deepEqual(result.declaration, { purposes: ["booking"], scopes: ["/schedule-tour"] });
  });

  test("a declaration the signature didn't cover is ignored, while the identity still verifies", async () => {
    const { signed, keys } = await signedRequest("https://agent.example.com", TARGET, {
      declaration: 'purpose="booking"',
      coverDeclaration: false,
    });
    const result = await classifyRequest(signed, "203.0.113.9", { loadKeys: async () => keys });
    assert.equal(result.tier, "verified", "the identity is still verified");
    assert.equal(result.declaration, null, "an unsigned declaration must not be treated as declared");
  });

  test("a verified agent that declares nothing is ordinary, not worse", async () => {
    const { signed, keys } = await signedRequest("https://agent.example.com");
    const result = await classifyRequest(signed, "203.0.113.9", { loadKeys: async () => keys });
    assert.equal(result.tier, "verified");
    assert.equal(result.declaration, null);
  });
});
