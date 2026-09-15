import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WIDGET_SIGNATURES, type WidgetSignature } from "./widget-signatures";
import { describeWidgetCheck, detectWidgets, selectorsFor } from "./widgets";

const none = { hosts: [], matchedSelectors: [] };

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
      assert.ok(s.hosts.length + s.selectors.length > 0, `${s.id} has nothing to match`);
      for (const host of s.hosts) assert.match(host, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, `${s.id} host ${host}`);
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
    assert.deepEqual(detectWidgets({ hosts: ["example.com", "fonts.gstatic.com"], matchedSelectors: [] }, WIDGET_SIGNATURES), []);
  });

  test("matches a script host and its subdomains, not lookalikes", () => {
    const sigs: WidgetSignature[] = [{ id: "x", name: "X", kind: "ai_agent", hosts: ["chatbase.co"], selectors: [] }];
    assert.equal(detectWidgets({ hosts: ["www.chatbase.co"], matchedSelectors: [] }, sigs).length, 1);
    assert.equal(detectWidgets({ hosts: ["CHATBASE.CO"], matchedSelectors: [] }, sigs).length, 1);
    assert.equal(detectWidgets({ hosts: ["notchatbase.co", "chatbase.co.evil.example"], matchedSelectors: [] }, sigs).length, 0);
  });

  test("reports each matching signal as evidence", () => {
    const [intercom] = detectWidgets(
      { hosts: ["widget.intercom.io", "example.com"], matchedSelectors: ["#intercom-container"] },
      WIDGET_SIGNATURES,
    );
    assert.equal(intercom.id, "intercom");
    assert.equal(intercom.kind, "chat_with_ai");
    assert.deepEqual(intercom.evidence, ["script or request from widget.intercom.io", "page element #intercom-container"]);
  });

  test("a selector match alone is enough", () => {
    const found = detectWidgets({ hosts: [], matchedSelectors: ["#chatbase-bubble-button"] }, WIDGET_SIGNATURES);
    assert.deepEqual(found.map((d) => d.id), ["chatbase"]);
  });

  // Regressions from checking live pages: these hosts load without a chat widget.
  test("shared vendor hosts don't count on their own", () => {
    for (const host of ["static.zdassets.com", "js.usemessages.com", "www.chatbase.co", "js.hubspot.com"]) {
      assert.deepEqual(detectWidgets({ hosts: [host], matchedSelectors: [] }, WIDGET_SIGNATURES), [], host);
    }
  });
});

describe("describeWidgetCheck", () => {
  test("AI-native providers are labeled as AI agents", () => {
    const detections = detectWidgets({ hosts: ["cdn.voiceflow.com"], matchedSelectors: [] }, WIDGET_SIGNATURES);
    const display = describeWidgetCheck({ kind: "result", detections, providersChecked: WIDGET_SIGNATURES.length });
    assert.equal(display.title, "AI agent widget on this page");
    assert.equal(display.items[0].title, "AI agent widget detected: Voiceflow");
    assert.equal(display.items[0].note, undefined);
  });

  test("chat vendors are not claimed to be AI", () => {
    const detections = detectWidgets({ hosts: ["js.driftt.com"], matchedSelectors: [] }, WIDGET_SIGNATURES);
    const display = describeWidgetCheck({ kind: "result", detections, providersChecked: WIDGET_SIGNATURES.length });
    assert.equal(display.title, "Chat widget on this page");
    assert.equal(display.items[0].title, "Chat widget detected: Drift");
    assert.match(display.items[0].note ?? "", /isn't visible from the page/);
    assert.doesNotMatch(JSON.stringify(display), /AI agent widget detected/);
  });

  test("no match says what was checked, without claiming the page has no AI", () => {
    const display = describeWidgetCheck({ kind: "result", detections: detectWidgets(none, WIDGET_SIGNATURES), providersChecked: 13 });
    assert.equal(display.title, "No known chat or AI agent widgets found");
    assert.match(display.summary, /13 known providers/);
  });

  test("pages that can't be inspected", () => {
    assert.equal(describeWidgetCheck({ kind: "unavailable" }).title, "Can't inspect this page");
    assert.equal(describeWidgetCheck({ kind: "preview" }).items.length, 0);
  });
});
