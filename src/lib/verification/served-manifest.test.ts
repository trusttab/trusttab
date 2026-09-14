import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, test } from "node:test";

import { buildManifest, reissueManifest } from "../manifest/build";
import { getPublicJwks, signManifest } from "../manifest/signing";
import { validateManifest } from "../manifest/validate";
import { isSameSite } from "../site-fetch";
import { evaluateServedManifest } from "./served-manifest";

// Throwaway issuer, read lazily by the modules above.
process.env.TRUSTTAB_SIGNING_PRIVATE_KEY = generateKeyPairSync("ed25519")
  .privateKey.export({ format: "der", type: "pkcs8" })
  .toString("base64");
process.env.TRUSTTAB_ISSUER_NAME = "TrustTab (test)";
process.env.TRUSTTAB_ISSUER_URL = "https://issuer.test";

const now = new Date("2026-09-14T12:00:00Z");
const signedFor = (domain: string, verificationId = "tt_aaaaaaaa2222") =>
  signManifest(
    buildManifest({
      domain,
      verificationId,
      now,
      input: {
        no_prompt_injection_pledge: true,
        agent_rate_limit: { requests_per_minute: 10, captcha_exempt: false },
        endpoints: [
          { path: "/contact", method: "POST", purpose: "lead_inquiry", schema: { email: "email" }, agent_safe: true, requires_captcha: false },
        ],
      },
    }),
  );

const evaluate = (body: string, at = now) =>
  evaluateServedManifest({ body, domain: "acme.com", verificationId: "tt_aaaaaaaa2222", jwks: getPublicJwks(), now: at });

describe("evaluateServedManifest", () => {
  test("genuine manifest for this domain passes both checks", () => {
    const v = evaluate(JSON.stringify(signedFor("acme.com")));
    assert.equal(v.domainMatch.passed, true);
    assert.equal(v.expiry.passed, true);
  });

  test("a verified competitor's manifest copied onto another domain fails", () => {
    const v = evaluate(JSON.stringify(signedFor("competitor.com")));
    assert.equal(v.domainMatch.passed, false);
    assert.match(v.domainMatch.message, /declares domain "competitor.com"/);
  });

  test("editing site.domain in a copied manifest breaks the signature", () => {
    const copied = signedFor("competitor.com");
    copied.site.domain = "acme.com";
    copied.issuer.verification_id = "tt_aaaaaaaa2222";
    assert.match(evaluate(JSON.stringify(copied)).domainMatch.message, /signature is invalid/);
  });

  test("another registration for the same domain fails", () => {
    const v = evaluate(JSON.stringify(signedFor("acme.com", "tt_bbbbbbbb3333")));
    assert.match(v.domainMatch.message, /different TrustTab registration/);
  });

  test("expired copy passes domain match but fails expiry", () => {
    const v = evaluate(JSON.stringify(signedFor("acme.com")), new Date("2026-11-01T00:00:00Z"));
    assert.equal(v.domainMatch.passed, true);
    assert.equal(v.expiry.passed, false);
  });

  test("non-JSON (e.g. an HTML 200 page) fails cleanly", () => {
    assert.match(evaluate("<html>not found</html>").domainMatch.message, /valid JSON/);
    assert.equal(evaluate("null").domainMatch.passed, false);
  });
});

describe("reissueManifest", () => {
  test("verified re-issue is schema-valid, signed and marks the scan passed", () => {
    const later = new Date("2026-09-20T00:00:00Z");
    const m = signManifest(reissueManifest(signedFor("acme.com"), { verified: true, scanStatus: "passed", now: later }));
    assert.deepEqual(validateManifest(m), []);
    assert.equal(m.site.verified_at, later.toISOString());
    assert.equal(m.site.expires_at, "2026-10-20T00:00:00.000Z");
    assert.deepEqual(m.policy.content_scan, { last_scanned: later.toISOString(), status: "passed" });
    assert.equal(evaluate(JSON.stringify(m), later).domainMatch.passed, true);
  });

  test("failed re-issue clears verified_at", () => {
    const verified = signManifest(reissueManifest(signedFor("acme.com"), { verified: true, scanStatus: "passed" }));
    const failed = reissueManifest(verified, { verified: false, scanStatus: "failed" });
    assert.equal(failed.site.verified_at, null);
    assert.equal(failed.policy.content_scan.status, "failed");
    assert.equal("signature" in failed.site, false);
  });
});

test("isSameSite only allows https on the domain or its www", () => {
  assert.equal(isSameSite(new URL("https://acme.com/x"), "acme.com"), true);
  assert.equal(isSameSite(new URL("https://www.acme.com/x"), "acme.com"), true);
  assert.equal(isSameSite(new URL("http://acme.com/x"), "acme.com"), false);
  assert.equal(isSameSite(new URL("https://evilacme.com/"), "acme.com"), false);
  assert.equal(isSameSite(new URL("https://acme.com.evil.com/"), "acme.com"), false);
  assert.equal(isSameSite(new URL("https://shop.acme.com/"), "acme.com"), false);
});
