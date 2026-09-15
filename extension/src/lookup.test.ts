import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { domainFromTabUrl, lookupDomain } from "./lookup";

describe("domainFromTabUrl", () => {
  test("normalizes like the server", () => {
    assert.deepEqual(domainFromTabUrl("https://WWW.LeaseTab.com/contact?x=1#top"), { ok: true, domain: "leasetab.com" });
    assert.deepEqual(domainFromTabUrl("https://shop.example.com/"), { ok: true, domain: "shop.example.com" });
    assert.deepEqual(domainFromTabUrl("https://bücher.de/"), { ok: true, domain: "xn--bcher-kva.de" });
  });

  test("nothing to check on browser, local and private pages", () => {
    for (const url of ["chrome://extensions", "file:///Users/x/a.html", "http://localhost:3000/", "https://192.168.1.1/", "about:blank", undefined, "not a url"]) {
      assert.equal(domainFromTabUrl(url).ok, false, String(url));
    }
  });
});

describe("lookupDomain", () => {
  const body = {
    verification_id: "tt_abcdefgh2345",
    status: "self_declared",
    domain: "leasetab.com",
    verified_at: null,
    expires_at: "2026-10-14T12:00:00.000Z",
    self_declared_endpoints: [],
  };
  const respond = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

  test("calls the by-domain route without cookies and parses the entry", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await lookupDomain("https://trusttab.test", "leasetab.com", fetchImpl);
    assert.equal(seen?.url, "https://trusttab.test/api/verify/by-domain/leasetab.com");
    assert.equal(seen?.init?.credentials, "omit");
    assert.equal(outcome.kind, "entry");
  });

  test("maps 404, 400, 429 and server errors to neutral outcomes", async () => {
    assert.deepEqual(await lookupDomain("https://t.test", "a.com", respond(404, { status: "not_found" })), { kind: "not_found" });
    assert.equal((await lookupDomain("https://t.test", "a.com", respond(400, {}))).kind, "not_applicable");
    assert.match(JSON.stringify(await lookupDomain("https://t.test", "a.com", respond(429, {}))), /Too many lookups/);
    assert.equal((await lookupDomain("https://t.test", "a.com", respond(500, {}))).kind, "error");
  });

  test("network failures and unexpected bodies are 'couldn't check', not a verdict", async () => {
    const failing = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    assert.equal((await lookupDomain("https://t.test", "a.com", failing)).kind, "error");
    assert.equal((await lookupDomain("https://t.test", "a.com", respond(200, { status: "verified" }))).kind, "error");
  });
});
