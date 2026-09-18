import assert from "node:assert/strict";
import { webcrypto as crypto } from "node:crypto";
import { describe, test } from "node:test";

import { jwkToKeyID, sign, verify } from "web-bot-auth";

import {
  describeMismatch,
  findScopeMismatch,
  formatDeclaration,
  INTENT_HEADER,
  parseIntentDeclaration,
  type PublishedEndpoint,
} from "./intent";

const ENDPOINTS: PublishedEndpoint[] = [
  { path: "/schedule-tour", purpose: "booking" },
  { path: "/contact", purpose: "lead_inquiry" },
  { path: "/account", purpose: "account_lookup" },
];

describe("parseIntentDeclaration", () => {
  test("reads purposes and scopes, quoted or bare", () => {
    assert.deepEqual(parseIntentDeclaration('purpose="booking"; scope="/schedule-tour"'), {
      purposes: ["booking"],
      scopes: ["/schedule-tour"],
    });
    assert.deepEqual(parseIntentDeclaration("purpose=booking; purpose=quote_request"), {
      purposes: ["booking", "quote_request"],
      scopes: [],
    });
  });

  test("uses the manifest's taxonomy: unknown purposes are dropped, not invented", () => {
    assert.equal(parseIntentDeclaration('purpose="scrape_everything"'), null);
    assert.deepEqual(parseIntentDeclaration('purpose="scrape_everything"; purpose="booking"')?.purposes, ["booking"]);
  });

  test("rejects junk, oversized headers and non-path scopes", () => {
    for (const header of [null, "", "nonsense", 'scope="../etc/passwd"', 'scope="https://evil.example"', `purpose="booking"; ${"x".repeat(500)}`]) {
      assert.equal(parseIntentDeclaration(header), null, String(header).slice(0, 30));
    }
  });
});

describe("findScopeMismatch", () => {
  const booking = parseIntentDeclaration('purpose="booking"; scope="/schedule-tour"')!;

  test("a request inside the declared scope is not a mismatch", () => {
    assert.equal(findScopeMismatch(booking, "/schedule-tour", ENDPOINTS), null);
    assert.equal(findScopeMismatch(booking, "/schedule-tour/step-2?utm=x", ENDPOINTS), null);
  });

  test("a request outside the declared scope is reported, as a fact", () => {
    const mismatch = findScopeMismatch(booking, "/account", ENDPOINTS);
    assert.equal(mismatch?.reason, "path-outside-scope");
    assert.equal(mismatch?.observedPath, "/account");
    assert.equal(mismatch?.observedPurpose, "account_lookup");
  });

  test("a purpose the site publishes but the agent didn't declare is reported", () => {
    const purposeOnly = parseIntentDeclaration('purpose="booking"')!;
    assert.equal(findScopeMismatch(purposeOnly, "/contact", ENDPOINTS)?.reason, "purpose-not-declared");
    // A path the site publishes nothing about is not a mismatch: most of a site isn't in its manifest.
    assert.equal(findScopeMismatch(purposeOnly, "/blog/hello", ENDPOINTS), null);
  });

  test("no declaration means nothing to compare, and is never itself a finding", () => {
    assert.equal(findScopeMismatch(null, "/anything", ENDPOINTS), null);
  });

  test("the wording states the difference and never characterises the agent", () => {
    const display = describeMismatch(findScopeMismatch(booking, "/account", ENDPOINTS)!);
    assert.match(display.title, /Declared booking under \/schedule-tour; requested \/account/);
    assert.doesNotMatch(
      `${display.title} ${display.detail}`,
      /malicious|attack|compromis|abus|hostile|bad actor|unauthoris|unauthoriz|breach/i,
    );
    assert.match(display.detail, /records the difference, not the reason/);
    assert.equal(formatDeclaration(booking), "booking under /schedule-tour");
  });
});

/**
 * The property the feature rests on: a declaration is only meaningful when the
 * signature covers it. Proven against the real library, not asserted.
 */
describe("tamper-evidence of a signed declaration", () => {
  const declaration = 'purpose="booking"; scope="/schedule-tour"';

  async function agent() {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey;
    const keyid = await jwkToKeyID(
      { ...jwk, kid: undefined } as JsonWebKey,
      (data: BufferSource) => crypto.subtle.digest("SHA-256", data),
      (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url"),
    );
    return {
      keyid,
      signer: {
        algorithm: "ed25519" as const,
        keyid,
        sign: async (data: Uint8Array) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, data)),
      },
      verifier: {
        algorithm: "ed25519" as const,
        keyid,
        verify: (data: Uint8Array, signature: Uint8Array) =>
          crypto.subtle.verify({ name: "Ed25519" }, publicKey, new Uint8Array(signature).slice(), new Uint8Array(data).slice()),
      },
    };
  }

  async function signedRequest(headers: Record<string, string>, cover: boolean) {
    const { signer, verifier } = await agent();
    const request = new Request("https://leasetab.com/schedule-tour", { headers });
    const fields = await sign(request, {
      signer,
      expires: new Date(Date.now() + 300_000),
      signatureAgentKey: "signature-agent",
      ...(cover ? { additionalComponents: [INTENT_HEADER] } : {}),
    });
    const signed = new Request(request, {
      headers: { ...Object.fromEntries(request.headers), signature: fields.signature, "signature-input": fields.signatureInput },
    });
    return { signed, verifier };
  }

  const base = { "user-agent": "ExampleAgent/1.0", "signature-agent": '"https://agent.example.com"' };

  test("a covered declaration verifies and is listed among the signed components", async () => {
    const { signed, verifier } = await signedRequest({ ...base, [INTENT_HEADER]: declaration }, true);
    const verified = await verify(signed, { resolver: () => verifier });
    const covered = verified.components.map((c) => (typeof c === "string" ? c : c.name).toLowerCase());
    assert.ok(covered.includes(INTENT_HEADER));
  });

  test("altering the declaration after signing breaks the signature", async () => {
    const { signed, verifier } = await signedRequest({ ...base, [INTENT_HEADER]: declaration }, true);
    const altered = new Request(signed, {
      headers: { ...Object.fromEntries(signed.headers), [INTENT_HEADER]: 'purpose="account_lookup"; scope="/account"' },
    });
    await assert.rejects(verify(altered, { resolver: () => verifier }));
  });

  test("removing the declaration after signing breaks the signature", async () => {
    const { signed, verifier } = await signedRequest({ ...base, [INTENT_HEADER]: declaration }, true);
    const headers = Object.fromEntries(signed.headers);
    delete headers[INTENT_HEADER];
    await assert.rejects(verify(new Request(signed, { headers }), { resolver: () => verifier }));
  });

  test("a declaration appended to someone else's valid signature is not covered by it", async () => {
    const { signed, verifier } = await signedRequest(base, false);
    const appended = new Request(signed, { headers: { ...Object.fromEntries(signed.headers), [INTENT_HEADER]: declaration } });
    // The signature still verifies — it never claimed to cover this header —
    // so the covered-component list is what decides whether to believe it.
    const verified = await verify(appended, { resolver: () => verifier });
    const covered = verified.components.map((c) => (typeof c === "string" ? c : c.name).toLowerCase());
    assert.equal(covered.includes(INTENT_HEADER), false);
  });
});
