import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { looksLikeManifest } from "./engine";
import { findManifestLink } from "./manifest-link";

const home = "https://www.acme.com/";

describe("findManifestLink", () => {
  test("finds the link in <head> and returns an absolute URL", () => {
    const html = `<html><head><link rel="agent-trust-manifest" href="https://issuer.test/api/manifest/acme.com"></head></html>`;
    assert.equal(findManifestLink(html, home), "https://issuer.test/api/manifest/acme.com");
  });

  test("resolves relative hrefs against the page URL", () => {
    const html = `<head><link rel="agent-trust-manifest" href="/files/agent-trust.json"></head>`;
    assert.equal(findManifestLink(html, home), "https://www.acme.com/files/agent-trust.json");
  });

  test("rel is a case-insensitive token list", () => {
    const html = `<head><link rel="alternate AGENT-TRUST-MANIFEST" href="https://issuer.test/m"></head>`;
    assert.equal(findManifestLink(html, home), "https://issuer.test/m");
  });

  test("ignores links in <body> (user-generated content)", () => {
    const html = `<html><head></head><body><link rel="agent-trust-manifest" href="https://evil.test/m"></body></html>`;
    assert.equal(findManifestLink(html, home), null);
  });

  test("ignores similar-looking rel values", () => {
    const html = `<head><link rel="agent-trust-manifest-v2" href="https://issuer.test/m"><link rel="manifest" href="/site.webmanifest"></head>`;
    assert.equal(findManifestLink(html, home), null);
  });

  test("accepts the equivalent <meta name> form", () => {
    const html = `<head><META NAME="Agent-Trust-Manifest" CONTENT=" https://issuer.test/api/manifest/acme.com "></head>`;
    assert.equal(findManifestLink(html, home), "https://issuer.test/api/manifest/acme.com");
  });

  test("prefers <link> when both forms are present", () => {
    const html = `<head><meta name="agent-trust-manifest" content="https://a.test/m"><link rel="agent-trust-manifest" href="https://b.test/m"></head>`;
    assert.equal(findManifestLink(html, home), "https://b.test/m");
  });

  test("ignores the meta form in <body> and empty content", () => {
    assert.equal(findManifestLink(`<html><head></head><body><meta name="agent-trust-manifest" content="https://evil.test/m"></body></html>`, home), null);
    assert.equal(findManifestLink(`<head><meta name="agent-trust-manifest" content="  "></head>`, home), null);
  });

  test("returns null for an unparseable href", () => {
    assert.equal(findManifestLink(`<head><link rel="agent-trust-manifest" href="https://[bad"></head>`, home), null);
  });
});

describe("looksLikeManifest", () => {
  test("accepts manifest-shaped JSON", () => {
    assert.equal(looksLikeManifest(JSON.stringify({ version: "1.0", issuer: {}, site: {} })), true);
  });
  test("rejects HTML shells, JSON error bodies and primitives", () => {
    for (const body of ["<!doctype html><div id=root></div>", '{"error":"reserved path"}', "null", "[]", '"site issuer"']) {
      assert.equal(looksLikeManifest(body), false, body);
    }
  });
});
