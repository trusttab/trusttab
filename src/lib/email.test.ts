import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveEmailTransport } from "./email";
import { verificationEmail } from "./email-templates";

describe("resolveEmailTransport", () => {
  test("uses Resend only when both the key and sender are set", () => {
    assert.equal(resolveEmailTransport({ RESEND_API_KEY: "k", EMAIL_FROM: "a@b.test", NODE_ENV: "production" }), "resend");
    assert.equal(resolveEmailTransport({ RESEND_API_KEY: "k", NODE_ENV: "production" }), "disabled");
    assert.equal(resolveEmailTransport({ EMAIL_FROM: "a@b.test", NODE_ENV: "production" }), "disabled");
  });
  test("prints to the console in development or when explicitly asked", () => {
    assert.equal(resolveEmailTransport({ NODE_ENV: "development" }), "console");
    assert.equal(resolveEmailTransport({ NODE_ENV: "production", EMAIL_TRANSPORT: "console" }), "console");
  });
  test("is disabled in production without a provider (never silently logs links)", () => {
    assert.equal(resolveEmailTransport({ NODE_ENV: "production" }), "disabled");
  });
  test("a configured provider wins over console mode", () => {
    assert.equal(resolveEmailTransport({ RESEND_API_KEY: "k", EMAIL_FROM: "a@b.test", NODE_ENV: "development" }), "resend");
  });
});

describe("verificationEmail", () => {
  test("includes the link in both parts and the expiry", () => {
    const url = "https://issuer.test/api/auth/verify-email?token=abc&callbackURL=%2Femail-verified";
    const email = verificationEmail({ url, issuerName: "TrustTab", expiresInMinutes: 60 });
    assert.equal(email.subject, "Verify your email for TrustTab");
    assert.ok(email.text.includes(url));
    assert.ok(email.html.includes("token=abc&amp;callbackURL=%2Femail-verified"));
    assert.match(email.text, /expires in 60 minutes/);
  });
  test("escapes HTML in the issuer name and URL", () => {
    const email = verificationEmail({ url: 'https://x.test/"><script>', issuerName: "<b>Evil</b>", expiresInMinutes: 60 });
    assert.doesNotMatch(email.html, /<script>|<b>Evil/);
    assert.match(email.html, /&lt;b&gt;Evil&lt;\/b&gt;/);
  });
});
