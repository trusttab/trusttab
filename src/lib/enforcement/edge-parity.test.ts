import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

// The Worker is plain JS, deployed as a single standalone file; these two
// helpers are exported purely so the fixtures below can run through both
// implementations.
import { evaluate, parseDeclaration } from "../../../collectors/cloudflare-worker.js";
import { findScopeMismatch, parseIntentDeclaration, type PublishedEndpoint } from "@/lib/agent-traffic/intent";
import { PURPOSES, type Purpose } from "@/lib/manifest/types";

const WORKER = readFileSync(path.resolve(process.cwd(), "collectors/cloudflare-worker.js"), "utf8");

/**
 * The observe-only milestone's two load-bearing guarantees. Neither is visible
 * by reading the Worker casually, and both would fail silently: a Worker that
 * blocked would look like a site outage, and a Worker whose scope logic drifted
 * from the server's would quietly produce evidence that doesn't mean what the
 * dashboard says it means.
 */

describe("the Worker cannot block", () => {
  test("it returns the origin's response and constructs none of its own", () => {
    // Any Response built in the Worker is a response that isn't the origin's.
    assert.doesNotMatch(WORKER, /new Response\(/, "the Worker must never construct a response");
    assert.match(WORKER, /const response = await fetch\(request\);/, "it fetches the origin");
    assert.match(WORKER, /return response;/, "and returns exactly that");
  });

  test("it contains no blocking vocabulary at all", () => {
    // Not even behind a flag: blocking is a separate milestone that has not
    // been signed off, so none of it may exist yet. Comments are stripped
    // first — the file *describes* what it refuses to do, and the test is
    // about the code, not the prose.
    const code = WORKER.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    const forbidden = /\bstatus:\s*4\d\d|\bstatus:\s*5\d\d|\.block\(|blockRequest|denyRequest|challenge\(|\bthrottle\b/i;
    assert.doesNotMatch(code, forbidden);
  });

  test("the only mode it accepts from a feed is observe", () => {
    assert.match(WORKER, /feed\.mode !== "observe"/);
  });

  test("an expired feed is dropped rather than reused", () => {
    assert.match(WORKER, /Date\.parse\(feedState\.feed\.expires_at\) > now/, "a cached feed is checked against its own expiry");
    assert.match(WORKER, /Date\.parse\(feed\.expires_at\) > now/, "and so is a freshly fetched one");
    // The property that makes this fail open: nothing may reach for a previous
    // feed once the current one has expired.
    assert.doesNotMatch(WORKER, /lastKnown|previousFeed|staleFeed|fallbackFeed/i);
  });

  test("it verifies the feed signature before using it", () => {
    assert.match(WORKER, /if \(!\(await verifyFeed\(/, "an unverified feed is never parsed into rules");
  });

  /**
   * Step 3 gave the Worker the ability to verify signatures locally, which is
   * precisely the capability blocking would need. These assert that the new
   * capability stays on the reporting side of the line.
   */
  test("the request handler does no verification and reads no verdict", () => {
    const handler = WORKER.slice(WORKER.indexOf("async fetch(request, env, ctx)"), WORKER.indexOf("export default worker"));
    for (const forbidden of ["verifySignatureLocally", "currentFeed", "evaluate(", "signature_verdict", "would_block"]) {
      assert.ok(!handler.includes(forbidden), `the fetch handler must not reference ${forbidden}`);
    }
    // All it may do is fetch the origin and hand the request to the reporter.
    assert.match(handler, /const response = await fetch\(request\);/);
    assert.match(handler, /ctx\.waitUntil\(report\(request, env\)/, "reporting happens after the response, off the request path");
  });

  test("the local signature verdict only ever reaches the report payload", () => {
    // Every use of the verdict must be inside report(); nothing may branch on it.
    const uses = [...WORKER.matchAll(/verifySignatureLocally\(/g)].length;
    assert.equal(uses, 2, "one definition, one call — no second call site to branch on");
    assert.doesNotMatch(WORKER, /if\s*\(\s*signature\.verdict/, "nothing branches on the verdict");
    assert.doesNotMatch(WORKER, /verdict\s*===\s*"invalid"\s*\)\s*(return|throw)/, "the verdict never short-circuits anything");
  });

  test("the edge never fetches a key directory itself", () => {
    // Signature-Agent is attacker-controlled; fetching the URL it names would
    // be a request-forgery and amplification vector. Keys come from the feed.
    assert.doesNotMatch(WORKER, /http-message-signatures-directory/, "no directory path is referenced");
    // Every fetch must target either the origin or TrustTab — never a URL
    // derived from anything the visitor sent.
    // `await fetch(` only: the handler's own `async fetch(request, env, ctx)`
    // declaration is the Worker's entry point, not an outbound request.
    const callSites = WORKER.split("\n").filter((line) => /await fetch\(/.test(line));
    assert.ok(callSites.length >= 3, "the known fetches are still there");
    for (const line of callSites) {
      assert.match(
        line,
        /fetch\(request\)|fetch\(`\$\{baseUrl\(env\)\}/,
        `the Worker may only fetch the origin or TrustTab: ${line.trim()}`,
      );
    }
  });
});

describe("edge and server agree on what falls outside a declaration", () => {
  const endpoints: PublishedEndpoint[] = [
    { path: "/schedule-tour", purpose: "booking" as Purpose },
    { path: "/contact", purpose: "lead_inquiry" as Purpose },
  ];

  /**
   * Fixtures run through both implementations. The Worker is duplicated rather
   * than importing the server's module because it deploys as one standalone
   * file; this is what stops the duplication from drifting.
   */
  const cases: { name: string; declaration: string | null; path: string; mismatch: boolean }[] = [
    { name: "no declaration at all", declaration: null, path: "/anything", mismatch: false },
    { name: "inside the declared scope", declaration: 'purpose="booking"; scope="/schedule-tour"', path: "/schedule-tour", mismatch: false },
    { name: "a child of the declared scope", declaration: 'scope="/schedule-tour"', path: "/schedule-tour/step-2", mismatch: false },
    { name: "outside every declared scope", declaration: 'scope="/schedule-tour"', path: "/account", mismatch: true },
    { name: "a prefix that is not a path boundary", declaration: 'scope="/schedule"', path: "/schedule-tour", mismatch: true },
    { name: "a purpose the site publishes but the agent didn't declare", declaration: 'purpose="booking"', path: "/contact", mismatch: true },
    { name: "a purpose declared and published alike", declaration: 'purpose="lead_inquiry"', path: "/contact", mismatch: false },
    { name: "a path the site publishes nothing about", declaration: 'purpose="booking"', path: "/blog/post", mismatch: false },
    { name: "several scopes, one of which matches", declaration: 'scope="/a"; scope="/schedule-tour"', path: "/schedule-tour", mismatch: false },
    { name: "an unknown purpose is ignored, leaving nothing declared", declaration: 'purpose="not_a_purpose"', path: "/contact", mismatch: false },
  ];

  test("a feed with no taxonomy evaluates scopes only, rather than trusting purposes", () => {
    const request = new Request("https://example.com/contact", { headers: { "intent-declaration": 'purpose="booking"' } });
    // With the taxonomy: /contact is published as lead_inquiry, which was not
    // declared, so this is a mismatch.
    assert.equal(evaluate(request, { endpoints, purposes: [...PURPOSES] }), "purpose-not-declared");
    // Without it: no purpose survives, nothing is declared to compare, and the
    // edge reports nothing rather than guessing.
    assert.equal(evaluate(request, { endpoints }), null);
  });

  for (const testCase of cases) {
    test(testCase.name, () => {
      const request = new Request(`https://example.com${testCase.path}`, {
        headers: testCase.declaration ? { "intent-declaration": testCase.declaration } : {},
      });
      // The feed as actually served, taxonomy included.
      const edge = evaluate(request, { endpoints, purposes: [...PURPOSES] }) as string | null;

      const server = findScopeMismatch(parseIntentDeclaration(testCase.declaration), testCase.path, endpoints);

      assert.equal(edge !== null, testCase.mismatch, `edge verdict for ${testCase.name}`);
      assert.equal(server !== null, testCase.mismatch, `server verdict for ${testCase.name}`);
      assert.equal(edge, server?.reason ?? null, "edge and server give the same reason, not just the same verdict");
    });
  }
});

describe("the edge's declaration parsing matches the server's", () => {
  const headers = [
    'purpose="booking"; scope="/schedule-tour"',
    "purpose=booking",
    'purpose="booking"; purpose="quote_request"',
    'scope="/a"; scope="/b"',
    'purpose="booking"; nonsense="x"',
    "",
    "not a declaration",
    'scope="no-leading-slash"',
  ];

  for (const header of headers) {
    test(`"${header}"`, () => {
      const edge = parseDeclaration(header) as { purposes: string[]; scopes: string[] } | null;
      const server = parseIntentDeclaration(header);
      assert.deepEqual(edge?.scopes ?? null, server?.scopes ?? null, "same scopes");
      // The edge keeps purposes it can't validate (it has no taxonomy); what
      // matters is that a purpose the server accepts is one the edge also kept.
      for (const purpose of server?.purposes ?? []) {
        assert.ok(edge?.purposes.includes(purpose), `edge kept ${purpose}`);
      }
    });
  }
});
