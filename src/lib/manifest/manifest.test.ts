import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, test } from "node:test";

import { buildManifest, generateVerificationId } from "./build";
import { canonicalize } from "./canonical-json";
import { fieldsToText, textToFields } from "./fields-text";
import { verifyManifestSignature } from "./signature-verify";
import { getPublicJwks, signManifest } from "./signing";
import type { Manifest, ManifestInput } from "./types";
import { validateManifest } from "./validate";

// A throwaway issuer and key. The modules read these lazily on first use, so
// setting them here (after the imports) is early enough.
process.env.TRUSTTAB_SIGNING_PRIVATE_KEY = generateKeyPairSync("ed25519")
  .privateKey.export({ format: "der", type: "pkcs8" })
  .toString("base64");
process.env.TRUSTTAB_ISSUER_NAME = "TrustTab (test)";
process.env.TRUSTTAB_ISSUER_URL = "https://issuer.test/";

const input: ManifestInput = {
  no_prompt_injection_pledge: true,
  agent_rate_limit: { requests_per_minute: 30, captcha_exempt: false },
  endpoints: [
    {
      path: "/contact",
      method: "POST",
      purpose: "lead_inquiry",
      schema: { email: "email", message: "string", phone: "phone?", topic: "enum[sales,support]" },
      agent_safe: true,
      requires_captcha: false,
      self_attested: false,
    },
  ],
};

const makeSigned = (overrides: Partial<ManifestInput> = {}): Manifest =>
  signManifest(
    buildManifest({
      domain: "example.com",
      verificationId: "tt_abcdefgh2345",
      input: { ...input, ...overrides },
      now: new Date("2026-09-15T00:00:00Z"), // fixed clock so expiry is deterministic
    }),
  );

describe("canonicalize (RFC 8785)", () => {
  test("sorts keys recursively and strips whitespace", () => {
    assert.equal(canonicalize({ b: 1, a: { d: [true, null], c: "x" } }), '{"a":{"c":"x","d":[true,null]},"b":1}');
  });
  test("is independent of key insertion order", () => {
    assert.equal(canonicalize({ x: 1, y: 2 }), canonicalize({ y: 2, x: 1 }));
  });
  test("sorts by UTF-16 code units and escapes like JSON.stringify", () => {
    assert.equal(canonicalize({ "é": 1, z: 2, "\n": 3 }), '{"\\n":3,"z":2,"é":1}');
  });
});

describe("signing", () => {
  test("a signed manifest verifies against the published JWKS", () => {
    const manifest = makeSigned();
    assert.match(manifest.site.signature, /^[\w-]+\.\.[\w-]+$/);
    assert.equal(verifyManifestSignature(manifest, getPublicJwks()), true);
  });

  test("verification survives a JSON round trip with reordered keys", () => {
    const manifest = makeSigned();
    const reordered = JSON.parse(canonicalize(manifest)) as Manifest;
    assert.equal(verifyManifestSignature(reordered, getPublicJwks()), true);
  });

  test("any change to the content breaks the signature", () => {
    const manifest = makeSigned();
    const tampered = structuredClone(manifest);
    tampered.site.domain = "evil.com";
    assert.equal(verifyManifestSignature(tampered, getPublicJwks()), false);

    const tampered2 = structuredClone(manifest);
    tampered2.endpoints[0].agent_safe = false;
    assert.equal(verifyManifestSignature(tampered2, getPublicJwks()), false);
  });

  test("a signature from a different key does not verify", () => {
    const manifest = makeSigned();
    const { publicKey } = generateKeyPairSync("ed25519");
    const { x } = publicKey.export({ format: "jwk" }) as { x: string };
    const [{ kid }] = getPublicJwks().keys;
    const otherJwks = { keys: [{ ...getPublicJwks().keys[0], x, kid }] };
    assert.equal(verifyManifestSignature(manifest, otherJwks), false);
  });

  test("malformed signatures return false instead of throwing", () => {
    const manifest = makeSigned();
    for (const signature of ["", "abc", "a.b.c", "!!..!!"]) {
      assert.equal(verifyManifestSignature({ ...manifest, site: { ...manifest.site, signature } }, getPublicJwks()), false);
    }
  });
});

describe("validateManifest (agent-trust.schema.json)", () => {
  test("a well-formed signed manifest is valid", () => {
    assert.deepEqual(validateManifest(makeSigned()), []);
  });

  test("issuer and scan defaults are filled in by TrustTab", () => {
    const m = makeSigned();
    assert.equal(m.issuer.url, "https://issuer.test");
    assert.equal(m.site.verified_at, null);
    assert.equal(m.site.verification_status, "unverified");
    assert.equal(m.endpoints[0].verified_by, null);
    assert.equal(m.site.expires_at, "2026-10-15T00:00:00.000Z");
    assert.deepEqual(m.policy.content_scan, { last_scanned: null, status: "pending" });
  });

  const invalidCases: [string, (m: Manifest) => void][] = [
    ["unknown purpose", (m) => ((m.endpoints[0] as { purpose: string }).purpose = "free_text")],
    ["pledge not given", (m) => ((m.policy as { no_prompt_injection_pledge: boolean }).no_prompt_injection_pledge = false)],
    ["bad field type", (m) => (m.endpoints[0].schema.email = "varchar(255)")],
    ["protocol-relative path", (m) => (m.endpoints[0].path = "//evil.com/form")],
    ["unsupported method", (m) => ((m.endpoints[0] as { method: string }).method = "DELETE")],
    ["extra top-level field", (m) => ((m as Record<string, unknown>).trusted = true)],
    ["non-https issuer", (m) => (m.issuer.url = "http://issuer.test")],
    ["bad verification id", (m) => (m.issuer.verification_id = "abc")],
    ["no endpoints", (m) => (m.endpoints = [])],
    ["rate limit out of range", (m) => (m.policy.agent_rate_limit.requests_per_minute = 0)],
    ["unknown verification status", (m) => ((m.site as { verification_status: string }).verification_status = "mostly")],
    ["unknown verified_by", (m) => ((m.endpoints[0] as { verified_by: string }).verified_by = "someone")],
    ["missing self_attested", (m) => delete (m.endpoints[0] as Partial<Manifest["endpoints"][0]>).self_attested],
  ];
  for (const [name, mutate] of invalidCases) {
    test(`rejects: ${name}`, () => {
      const m = structuredClone(makeSigned());
      mutate(m);
      assert.notDeepEqual(validateManifest(m), []);
    });
  }

  test("explains a missing pledge in plain language", () => {
    const m = makeSigned({ no_prompt_injection_pledge: false });
    assert.deepEqual(validateManifest(m), [
      { path: "/policy/no_prompt_injection_pledge", message: "must be accepted to publish a manifest" },
    ]);
  });

  test("rejects duplicate method + path", () => {
    const m = makeSigned({ endpoints: [input.endpoints[0], input.endpoints[0]] });
    assert.match(validateManifest(m)[0].message, /duplicate endpoint POST \/contact/);
  });

  test("accepts every documented field type form", () => {
    const schema = Object.fromEntries(
      ["string", "number", "boolean", "email", "phone", "url", "date", "file", "array<string>", "enum[a,b-c,d_e]", "string?", "array<file>?"].map(
        (t, i) => [`f${i}`, t],
      ),
    );
    assert.deepEqual(validateManifest(makeSigned({ endpoints: [{ ...input.endpoints[0], schema }] })), []);
  });
});

describe("fields text format", () => {
  test("round-trips", () => {
    const text = "email: email\nmessage: string?\ntopic: enum[a,b]";
    const parsed = textToFields(text);
    assert.ok(parsed.ok);
    assert.equal(fieldsToText(parsed.schema), text);
  });
  test("tolerates blank lines and spaces in enums", () => {
    assert.deepEqual(textToFields("\n a : enum[x, y] \n\n"), { ok: true, schema: { a: "enum[x,y]" } });
  });
  test("reports malformed lines and duplicates", () => {
    assert.equal(textToFields("just a name").ok, false);
    assert.equal(textToFields("a: string\na: email").ok, false);
  });
});

test("verification ids match the schema pattern", () => {
  for (let i = 0; i < 50; i++) assert.match(generateVerificationId(), /^tt_[a-z2-7]{12}$/);
});
