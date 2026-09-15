import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WIDGET_SIGNATURES, type WidgetSignature } from "./widget-signatures";
import { describeWidgetCheck, detectWidgets, selectorsFor } from "./widgets";

const none = { pageHost: "example.com", hosts: [], matchedSelectors: [] };

/** Minimal syntax check (node has no DOM): balanced brackets and quotes. */
function assertCssSyntax(selector: string) {
  if ((selector.match(/\[/g) ?? []).length !== (selector.match(/\]/g) ?? []).length) throw new Error("brackets");
  if ((selector.match(/"/g) ?? []).length % 2 !== 0) throw new Error("quotes");
}

describe("WIDGET_SIGNATURES", () => {
  test("entries are well-formed and unique", () => {
    const ids = new Set<string>();
    for (const s of WIDGET_SIGNATURES) {
      assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
      ids.add(s.id);
      assert.ok(s.name.length > 0);
      assert.ok(s.hosts.length + s.selectors.length + (s.pageDomains?.length ?? 0) > 0, `${s.id} has nothing to match`);
      for (const host of [...s.hosts, ...(s.pageDomains ?? [])]) assert.match(host, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `${s.id} host ${host}`);
      // An AI application is identified by its own domain, and nothing else.
      if (s.kind === "ai_application") assert.ok(s.pageDomains?.length && s.hosts.length === 0 && s.selectors.length === 0, s.id);
      else assert.equal(s.pageDomains, undefined, s.id);
    }
  });

  test("selectors are specific (no bare tags or generic chat names)", () => {
    for (const selector of selectorsFor(WIDGET_SIGNATURES)) {
      assert.match(selector, /[#.[]/, selector);
      assert.doesNotThrow(() => assertCssSyntax(selector), selector);
      assert.doesNotMatch(selector, /^[#.](chat|widget|chatbot|support)$/i, selector);
    }
  });

  test("the list is JSON-serializable, as executeScript args must be", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(WIDGET_SIGNATURES)), WIDGET_SIGNATURES);
  });
});

describe("detectWidgets", () => {
  test("nothing on a plain page", () => {
    assert.deepEqual(detectWidgets({ pageHost: "example.com", hosts: ["example.com", "fonts.gstatic.com"], matchedSelectors: [] }, WIDGET_SIGNATURES), []);
  });

  test("matches a script host and its subdomains, not lookalikes", () => {
    const sigs: WidgetSignature[] = [{ id: "x", name: "X", kind: "ai_agent", hosts: ["chatbase.co"], selectors: [] }];
    assert.equal(detectWidgets({ pageHost: "example.com", hosts: ["www.chatbase.co"], matchedSelectors: [] }, sigs).length, 1);
    assert.equal(detectWidgets({ pageHost: "example.com", hosts: ["CHATBASE.CO"], matchedSelectors: [] }, sigs).length, 1);
    assert.equal(detectWidgets({ pageHost: "example.com", hosts: ["notchatbase.co", "chatbase.co.evil.example"], matchedSelectors: [] }, sigs).length, 0);
  });

  test("reports each matching signal as evidence", () => {
    const [intercom] = detectWidgets(
      { pageHost: "example.com", hosts: ["widget.intercom.io", "example.com"], matchedSelectors: ["#intercom-container"] },
      WIDGET_SIGNATURES,
    );
    assert.equal(intercom.id, "intercom");
    assert.equal(intercom.kind, "chat_with_ai");
    assert.deepEqual(intercom.evidence, ["script or request from widget.intercom.io", "page element #intercom-container"]);
  });

  test("AI applications are matched on the page's own domain, including subdomains", () => {
    for (const [host, id] of [["claude.ai", "claude"], ["www.chatgpt.com", "chatgpt"], ["chat.openai.com", "chatgpt"], ["gemini.google.com", "gemini"], ["www.perplexity.ai", "perplexity"]] as const) {
      const found = detectWidgets({ pageHost: host, hosts: [], matchedSelectors: [] }, WIDGET_SIGNATURES);
      assert.deepEqual(found.map((d) => d.id), [id], host);
      assert.deepEqual(found[0].evidence, [`this page's own address (${host})`]);
    }
  });

  test("lookalike domains, and other pages' requests to an AI app, don't count", () => {
    for (const host of ["notclaude.ai", "claude.ai.evil.example", "myclaude.ai", "example.com"]) {
      assert.deepEqual(detectWidgets({ pageHost: host, hosts: [], matchedSelectors: [] }, WIDGET_SIGNATURES), [], host);
    }
    // A page that merely links to or loads something from an AI app is not that app.
    assert.deepEqual(detectWidgets({ pageHost: "example.com", hosts: ["claude.ai", "chatgpt.com"], matchedSelectors: [] }, WIDGET_SIGNATURES), []);
  });

  test("a selector match alone is enough", () => {
    const found = detectWidgets({ pageHost: "example.com", hosts: [], matchedSelectors: ["#chatbase-bubble-button"] }, WIDGET_SIGNATURES);
    assert.deepEqual(found.map((d) => d.id), ["chatbase"]);
  });

  // Regressions from checking live pages: these hosts load without a chat widget.
  test("shared vendor hosts don't count on their own", () => {
    for (const host of ["static.zdassets.com", "js.usemessages.com", "www.chatbase.co", "js.hubspot.com"]) {
      assert.deepEqual(detectWidgets({ pageHost: "example.com", hosts: [host], matchedSelectors: [] }, WIDGET_SIGNATURES), [], host);
    }
  });
});

describe("describeWidgetCheck", () => {
  test("AI-native providers are labeled as AI agents", () => {
    const detections = detectWidgets({ pageHost: "example.com", hosts: ["cdn.voiceflow.com"], matchedSelectors: [] }, WIDGET_SIGNATURES);
    const display = describeWidgetCheck({ kind: "result", detections, providersChecked: WIDGET_SIGNATURES.length });
    assert.equal(display.title, "AI agent widget on this page");
    assert.equal(display.items[0].title, "AI agent widget detected: Voiceflow");
    assert.equal(display.items[0].note, undefined);
  });

  test("chat vendors are not claimed to be AI", () => {
    const detections = detectWidgets({ pageHost: "example.com", hosts: ["js.driftt.com"], matchedSelectors: [] }, WIDGET_SIGNATURES);
    const display = describeWidgetCheck({ kind: "result", detections, providersChecked: WIDGET_SIGNATURES.length });
    assert.equal(display.title, "Chat widget on this page");
    assert.equal(display.items[0].title, "Chat widget detected: Drift");
    assert.match(display.items[0].note ?? "", /isn't visible from the page/);
    assert.doesNotMatch(JSON.stringify(display), /AI agent widget detected/);
  });

  test("an AI application is stated as fact, and kept separate from the writing estimate", () => {
    const detections = detectWidgets({ pageHost: "claude.ai", hosts: [], matchedSelectors: [] }, WIDGET_SIGNATURES);
    const display = describeWidgetCheck({ kind: "result", detections, providersChecked: WIDGET_SIGNATURES.length });
    assert.equal(display.title, "AI application");
    assert.equal(display.items[0].title, "Native AI application detected: Claude");
    assert.match(display.items[0].note ?? "", /doesn't say whether any text on the page was written by AI/);
    assert.doesNotMatch(JSON.stringify(display), /estimate/i);
  });

  test("no match says what was checked, without claiming the page has no AI", () => {
    const display = describeWidgetCheck({ kind: "result", detections: detectWidgets(none, WIDGET_SIGNATURES), providersChecked: 13 });
    assert.equal(display.title, "No known AI applications or chat widgets found");
    assert.match(display.summary, /13 known providers/);
  });

  test("pages that can't be inspected", () => {
    assert.equal(describeWidgetCheck({ kind: "unavailable" }).title, "Can't inspect this page");
    assert.equal(describeWidgetCheck({ kind: "preview" }).items.length, 0);
  });
});
