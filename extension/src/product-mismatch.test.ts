import assert from "node:assert/strict";
import { describe, test } from "node:test";

import fixture from "./fixtures/hermes-agent.json";
import { KNOWN_PRODUCTS } from "./known-products";
import { describeProductMismatch, findProductMismatch, PLATFORM_DOMAINS, type PageIdentity } from "./product-mismatch";

const empty: PageIdentity = { title: null, ogSiteName: null, headings: [], structuredDataNames: [] };
const identity = (partial: Partial<PageIdentity>): PageIdentity => ({ ...empty, ...partial });

/**
 * The case this check was built from, captured live on 2026-09-17:
 * hermesagents.net presents itself as "Hermes Agent", which is the name of
 * Nous Research's unaffiliated open-source agent at
 * hermes-agent.nousresearch.com. Both pages are committed as a fixture so a
 * future change can't quietly stop catching it — or start flagging the real
 * product's own site.
 */
describe("the Hermes Agent case", () => {
  test("the unrelated domain claiming the name is reported", () => {
    const { host, identity: claim } = fixture.impersonating;
    const mismatch = findProductMismatch(claim as PageIdentity, host);
    assert.equal(mismatch?.product, "Hermes Agent");
    assert.equal(mismatch?.vendor, "Nous Research");
    assert.equal(mismatch?.canonicalDomain, "hermes-agent.nousresearch.com");
    assert.equal(mismatch?.domain, "hermesagents.net");
    assert.deepEqual(mismatch?.signals, ["page title", "site name metadata", "main heading", "structured data"]);
  });

  test("the real product's own site is never reported", () => {
    const { host, identity: claim } = fixture.genuine;
    assert.equal(findProductMismatch(claim as PageIdentity, host), null);
    // Nor its vendor's main site, or another subdomain of it.
    assert.equal(findProductMismatch(claim as PageIdentity, "nousresearch.com"), null);
    assert.equal(findProductMismatch(claim as PageIdentity, "docs.hermes-agent.nousresearch.com"), null);
  });

  test("the wording states the discrepancy, not intent, and admits the list is short", () => {
    const mismatch = findProductMismatch(fixture.impersonating.identity as PageIdentity, fixture.impersonating.host)!;
    const display = describeProductMismatch(mismatch);
    assert.match(display.title, /isn't one of Hermes Agent's known domains/);
    assert.doesNotMatch(JSON.stringify(display), /scam|fake|fraud|impersonat|stolen/i);
    assert.ok(display.details.some((d) => /not evidence that a product is genuine/.test(d)));
    assert.ok(display.details.some((d) => /can't tell which/.test(d)));
  });
});

describe("findProductMismatch guards", () => {
  test("a page that merely mentions a product is not claiming to be it", () => {
    for (const claim of [
      identity({ title: "How to install Hermes Agent on macOS" }),
      identity({ title: "Our integrations — Hermes Agent, LangChain and more" }),
      identity({ headings: ["Comparing Hermes Agent and OpenHands"] }),
    ]) {
      assert.equal(findProductMismatch(claim, "some-blog.example"), null, String(claim.title ?? claim.headings[0]));
    }
  });

  test("a title's leading claim counts, even with a tagline after it", () => {
    assert.equal(findProductMismatch(identity({ title: "Hermes Agent — a totally different thing" }), "elsewhere.example")?.product, "Hermes Agent");
  });

  test("platforms where anyone can publish are skipped", () => {
    const claim = fixture.impersonating.identity as PageIdentity;
    for (const host of ["github.com", "www.reddit.com", "medium.com", "huggingface.co", "my-app.vercel.app"]) {
      assert.equal(findProductMismatch(claim, host), null, host);
    }
    assert.ok(PLATFORM_DOMAINS.includes("github.com"));
  });

  test("one-word product names need two independent signals", () => {
    assert.equal(findProductMismatch(identity({ headings: ["Ollama"] }), "unrelated.example"), null);
    assert.equal(findProductMismatch(identity({ headings: ["Ollama"], ogSiteName: "Ollama" }), "unrelated.example")?.product, "Ollama");
  });

  test("pages with no identity, and products not on the list, report nothing", () => {
    assert.equal(findProductMismatch(empty, "anything.example"), null);
    assert.equal(findProductMismatch(identity({ title: "Some Unlisted Agent", ogSiteName: "Some Unlisted Agent" }), "unrelated.example"), null);
    assert.equal(findProductMismatch(identity({ title: "Hermes Agent" }), "localhost"), null);
  });
});

describe("the product list", () => {
  test("entries are well-formed, uniquely identified, and have real domains", () => {
    const ids = new Set<string>();
    for (const product of KNOWN_PRODUCTS) {
      assert.ok(!ids.has(product.id), `duplicate id ${product.id}`);
      ids.add(product.id);
      assert.ok(product.domains.length > 0 && product.vendor.length > 0, product.id);
      for (const domain of product.domains) assert.match(domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, domain);
    }
  });

  test("ordinary-word product names are deliberately absent, so unrelated businesses aren't flagged", () => {
    const names = KNOWN_PRODUCTS.flatMap((p) => [p.name, ...(p.aliases ?? [])].map((n) => n.toLowerCase()));
    for (const excluded of ["cursor", "devin", "manus", "lovable", "windsurf", "comet", "gemini"]) {
      assert.ok(!names.includes(excluded), `${excluded} is an ordinary word and should not be on the list`);
    }
  });

  test("no product's own domains would trip the check", () => {
    for (const product of KNOWN_PRODUCTS) {
      const claim = identity({ title: product.name, ogSiteName: product.name });
      for (const domain of product.domains) assert.equal(findProductMismatch(claim, domain), null, `${product.name} @ ${domain}`);
    }
  });
});
