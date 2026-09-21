import assert from "node:assert/strict";
import { describe, test } from "node:test";

import fixtures from "./fixtures/ai-self-description.json" with { type: "json" };
import { AI_SELF_DESCRIPTION_CAVEAT, findAiSelfDescription, type PageMetadata } from "./ai-self-description";

const blank: PageMetadata = { description: null, ogDescription: null, ogTitle: null, structuredData: [] };
const meta = (over: Partial<PageMetadata>): PageMetadata => ({ ...blank, ...over });

describe("the real cases this was built for", () => {
  test("leasetab.com's own description is recognised, and quoted back", () => {
    const found = findAiSelfDescription(fixtures.leasetab as PageMetadata);
    assert.ok(found.length > 0);
    assert.ok(found.some((f) => f.term === "AI-powered"), "matches its own words");
    assert.match(found[0].quote, /AI-powered leasing OS/, "quotes the site, never paraphrases");
    assert.equal(found[0].source, "meta description");
  });

  /**
   * The third motivating case, and it is deliberately not caught. GoDaddy's
   * "Airo, AI BUILDER" is visible page copy; its own metadata says nothing
   * about AI. Verified against the live rendered DOM on 2026-09-21 — a plain
   * fetch gets no metadata at all, so this had to be checked in a browser.
   *
   * Catching it would mean scanning arbitrary page prose, which is the
   * tone-judgment the spec rules out. This fixture exists so that line stays
   * where it is.
   */
  test("GoDaddy is not caught, because its own metadata makes no AI claim", () => {
    assert.deepEqual(findAiSelfDescription(fixtures.godaddy as PageMetadata), []);
  });

  test("vapi.ai's own description is recognised", () => {
    const found = findAiSelfDescription(fixtures.vapi as PageMetadata);
    assert.ok(found.some((f) => f.term === "AI agent" || f.term === "voice agent"));
    assert.match(found[0].quote, /voice AI agents/);
  });
});

describe("the two-letter AI token", () => {
  test('"AI" is matched case-sensitively, so ordinary words in other languages do not fire', () => {
    // "ai" is a real word in Italian and French; lowercase must not match.
    assert.deepEqual(findAiSelfDescription(meta({ description: "Noi siamo ai vostri servizi per la casa." })), []);
    assert.deepEqual(findAiSelfDescription(meta({ description: "Bienvenue, nous sommes ai votre service." })), []);
    assert.ok(findAiSelfDescription(meta({ description: "Our AI answers your calls." })).length > 0);
  });

  test("it does not fire inside longer words", () => {
    for (const text of ["Our staff in Dubai and Shanghai.", "Chennai office hours.", "Plain email and fax."]) {
      assert.deepEqual(findAiSelfDescription(meta({ description: text })), [], text);
    }
  });
});

describe("a page denying or contrasting with AI is not claiming it", () => {
  for (const description of [
    "No AI, no chatbots — you always speak to a real person.",
    "A human alternative to AI chatbots.",
    "Real people, not AI. Every call answered by our team.",
    "Our service is AI-free by design.",
    "Bookkeeping without artificial intelligence.",
  ]) {
    test(`"${description.slice(0, 44)}…"`, () => {
      assert.deepEqual(findAiSelfDescription(meta({ description })), []);
    });
  }
});

describe("sources and quoting", () => {
  test("structured data is read for the fields the spec names", () => {
    const found = findAiSelfDescription(meta({ structuredData: ["An AI-powered scheduling assistant for clinics."] }));
    assert.equal(found[0].source, "structured data");
  });

  test("og:description is read", () => {
    const found = findAiSelfDescription(meta({ ogDescription: "Meet our virtual assistant." }));
    assert.equal(found[0].source, "og:description");
    assert.equal(found[0].term, "virtual assistant");
  });

  test("the same claim repeated across sources is one finding, not several", () => {
    const text = "An AI-powered leasing OS.";
    const found = findAiSelfDescription(meta({ description: text, ogDescription: text, ogTitle: text }));
    assert.equal(found.filter((f) => f.term === "AI-powered").length, 1);
  });

  test("every finding carries the site's own sentence, within a readable length", () => {
    const found = findAiSelfDescription(meta({ description: `${"Padding sentence. ".repeat(30)}We use AI to route enquiries.` }));
    assert.ok(found.length > 0);
    for (const f of found) {
      assert.ok(f.quote.length <= 200, "quotes stay short");
      assert.ok(f.quote.length > 0);
    }
  });

  test("nothing is found in an empty or silent page", () => {
    assert.deepEqual(findAiSelfDescription(blank), []);
    assert.deepEqual(findAiSelfDescription(meta({ description: "Family-run bakery in Leeds since 1974." })), []);
  });
});

/** The line the spec draws: structured self-published metadata only. */
test("the caveat says plainly that silence proves nothing", () => {
  assert.match(AI_SELF_DESCRIPTION_CAVEAT, /doesn't mean the page has no AI feature/i);
  assert.match(AI_SELF_DESCRIPTION_CAVEAT, /published about itself/i);
});
