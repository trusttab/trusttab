import assert from "node:assert/strict";
import { test } from "node:test";

// The Worker's own verifier, exercised exactly as it runs at the edge: same
// WebCrypto, same Ed25519, same detached JWS over the same bytes.
import { verifyFeed } from "../../../collectors/cloudflare-worker.js";
import { buildEnforcementFeed } from "./feed";
import { canonicalize } from "@/lib/manifest/canonical-json";
import type { Purpose } from "@/lib/manifest/types";

/**
 * The architecture rests on a customer's edge being able to tell that the rules
 * it is about to evaluate came from this issuer, without a call to TrustTab.
 * Asserting that the server signs and the edge verifies is not enough — they
 * have to agree, which is a fact about the pair, not about either one.
 */

async function issuerKey() {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as { x: string };
  return { privateKey, jwks: { keys: [{ kty: "OKP", crv: "Ed25519", x: jwk.x, kid: "test-key", alg: "EdDSA", use: "sig" }] } };
}

const b64url = (text: string) => Buffer.from(text).toString("base64url");

/** Mirrors signDetachedOverString, without needing the issuer's real key. */
async function sign(body: string, privateKey: CryptoKey) {
  const header = b64url(JSON.stringify({ alg: "EdDSA", kid: "test-key" }));
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(`${header}.${b64url(body)}`));
  return `${header}..${Buffer.from(signature).toString("base64url")}`;
}

const feedBody = () =>
  canonicalize(
    buildEnforcementFeed({
      issuer: "https://trusttab-mu.vercel.app",
      domain: "example.com",
      verificationId: "tt_example1",
      endpoints: [{ path: "/schedule-tour", purpose: "booking" as Purpose }],
    }),
  );

test("a feed signed the way the server signs verifies the way the edge verifies", async () => {
  const { privateKey, jwks } = await issuerKey();
  const body = feedBody();
  assert.equal(await verifyFeed(body, await sign(body, privateKey), jwks), true);
});

test("a feed altered in transit does not verify", async () => {
  const { privateKey, jwks } = await issuerKey();
  const body = feedBody();
  const signature = await sign(body, privateKey);
  // A cache or a proxy widening a scope by one character.
  const tampered = body.replace("/schedule-tour", "/schedule-tou_");
  assert.notEqual(tampered, body);
  assert.equal(await verifyFeed(tampered, signature, jwks), false);
});

test("a feed signed by anyone else does not verify", async () => {
  const [issuer, impostor] = await Promise.all([issuerKey(), issuerKey()]);
  const body = feedBody();
  assert.equal(await verifyFeed(body, await sign(body, impostor.privateKey), issuer.jwks), false);
});

test("a missing, malformed or unknown-key signature is refused rather than thrown on", async () => {
  const { jwks } = await issuerKey();
  const body = feedBody();
  for (const signature of [null, undefined, "", "not-a-jws", "a.b.c", "onlyone", `${b64url('{"alg":"EdDSA","kid":"nope"}')}..AAAA`]) {
    assert.equal(await verifyFeed(body, signature, jwks), false, `refused: ${String(signature)}`);
  }
});

test("an unexpected algorithm is refused even with a known key id", async () => {
  const { privateKey, jwks } = await issuerKey();
  const body = feedBody();
  const header = b64url(JSON.stringify({ alg: "HS256", kid: "test-key" }));
  const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new TextEncoder().encode(`${header}.${b64url(body)}`));
  assert.equal(await verifyFeed(body, `${header}..${Buffer.from(signature).toString("base64url")}`, jwks), false);
});
