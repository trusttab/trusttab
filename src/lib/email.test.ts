import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveEmailTransport } from "./email";
import { passwordChangedEmail, passwordResetEmail, verificationEmail } from "./email-templates";

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

describe("password emails", () => {
  test("reset email carries the link, expiry and single-use note", () => {
    const url = "https://issuer.test/api/auth/reset-password/tok123?callbackURL=%2Freset-password";
    const email = passwordResetEmail({ url, issuerName: "TrustTab", expiresInMinutes: 60 });
    assert.equal(email.subject, "Reset your TrustTab password");
    assert.ok(email.text.includes(url));
    assert.ok(email.html.includes(url));
    assert.match(email.text, /expires in 60 minutes and can be used once/);
  });
  test("changed notice tells the owner what to do if it wasn't them", () => {
    const email = passwordChangedEmail({ issuerName: "TrustTab", loginUrl: "https://issuer.test/login", via: "reset" });
    assert.match(email.text, /signed out on all devices/);
    assert.match(
      passwordChangedEmail({ issuerName: "TrustTab", loginUrl: "https://issuer.test/login", via: "change" }).text,
      /all your other devices have been signed out/,
    );
    assert.match(email.text, /If it wasn't you/);
    assert.ok(email.html.includes('href="https://issuer.test/login"'));
  });
  test("escapes injected values", () => {
    const email = passwordChangedEmail({ issuerName: "<img src=x>", loginUrl: 'javascript:"x', via: "change" });
    assert.doesNotMatch(email.html, /<img src=x>|href="javascript:"x"/);
  });
});
