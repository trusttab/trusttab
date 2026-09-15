import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractForms, jsRenderingEvidence } from "./form-extract";

const page = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

describe("extractForms", () => {
  test("proposes exactly the fields and types in the HTML", () => {
    const forms = extractForms(
      page(`<form method="post" action="/send">
        <label for="n">Your name</label><input id="n" name="name" required>
        <input type="email" name="email" required>
        <input type="tel" name="phone">
        <select name="service" required><option value="">Pick one</option><option value="repair">Repair</option><option value="install">Install</option></select>
        <textarea name="message"></textarea>
        <input type="checkbox" name="newsletter">
        <input type="radio" name="size" value="s"><input type="radio" name="size" value="m">
        <input type="file" name="photos" multiple>
        <input type="hidden" name="csrf" value="x"><button name="go">Send</button>
      </form>`),
    );
    assert.equal(forms.length, 1);
    assert.equal(forms[0].method, "POST");
    assert.equal(forms[0].action, "/send");
    assert.deepEqual(
      Object.fromEntries(forms[0].fields.map((f) => [f.name, f.type])),
      {
        name: "string",
        email: "email",
        phone: "phone?",
        service: "enum[repair,install]",
        message: "string?",
        newsletter: "boolean?",
        size: "enum[s,m]?",
        photos: "array<file>?",
      },
    );
    assert.equal(forms[0].fields[0].label, "Your name");
  });

  test("falls back to string for enum values the schema can't express", () => {
    const [form] = extractForms(page(`<form><select name="when"><option>Next week</option><option>Today</option></select></form>`));
    assert.equal(form.fields[0].type, "string?");
  });

  test("skips names with whitespace and forms with no usable fields", () => {
    assert.deepEqual(extractForms(page(`<form><input name="bad name"><input type="submit"></form>`)), []);
  });

  test("truncates labels and strips control characters", () => {
    const [form] = extractForms(page(`<form><input name="a" placeholder="${"x".repeat(100)}"></form>`));
    assert.equal(form.fields[0].label?.length, 60);
  });
});

describe("jsRenderingEvidence", () => {
  /**
   * Regression fixture for a real miss. leasetab.com (built with Base44) has
   * no <form> in its HTML because the form is rendered by JavaScript, yet the
   * page ships ~3,400 characters of pre-rendered text for search engines.
   * The previous check required under 300 characters of text, reported "not
   * client-rendered", and the assistant told the owner it wasn't the JS case.
   * This fixture mirrors the structure measured on the live page (app mount
   * point, two module bundles, Base44 asset link, ~3.4K chars of text, no
   * forms) with placeholder text instead of the site's copy.
   */
  const prerenderedBuilderPage = `<!doctype html><html><head>
    <link href="https://media.base44.com/images/public/example/icon.png" rel="icon" type="image/png"/>
    <script type="module" crossorigin src="/assets/index-Ch3zkedY.js"></script>
    <script type="module" src="/assets/vendor-a1b2c3.js"></script>
    <link crossorigin href="/assets/index-Ch3zkedY.css" rel="stylesheet"/>
  </head><body>
    <div id="root"></div>
    <div class="seo-prerender"><h1>Example Property Management</h1><p>${"Example pre-rendered marketing copy for search engines. ".repeat(60)}</p></div>
  </body></html>`;

  test("a builder app shell with lots of pre-rendered SEO text is likely JS-rendered (leasetab.com regression)", () => {
    const evidence = jsRenderingEvidence(prerenderedBuilderPage);
    assert.equal(evidence.assessment, "likely_js_rendered");
    const signals = evidence.signals.join(" | ");
    assert.match(signals, /mount point \(root\)/);
    assert.match(signals, /bundle scripts/);
    assert.match(signals, /site builder \(Base44\)/);
    assert.match(signals, /pre-render text for search engines, so this doesn't mean the form is in the HTML/);
  });

  test("text volume never argues against JS rendering", () => {
    for (const repeat of [0, 5, 500]) {
      const html = page(`<div id="app"></div><script src="/static/js/main.abc123.js"></script><p>${"Words. ".repeat(repeat)}</p>`);
      assert.equal(jsRenderingEvidence(html).assessment, "likely_js_rendered", `repeat=${repeat}`);
    }
  });

  test("embedded form widgets count as JS-rendered forms", () => {
    const html = page(`<h1>Contact us</h1><p>We reply within a day.</p><script src="https://js.hsforms.net/forms/embed/v2.js"></script>`);
    const evidence = jsRenderingEvidence(html);
    assert.equal(evidence.assessment, "likely_js_rendered");
    assert.match(evidence.signals.join(" "), /HubSpot/);
  });

  test("a plain server-rendered page without app signals is still only 'possibly', never ruled out", () => {
    const evidence = jsRenderingEvidence(page(`<main><h1>Plumbing</h1><p>${"Real server-rendered content. ".repeat(20)}</p></main>`));
    assert.equal(evidence.assessment, "possibly_js_rendered");
    assert.match(evidence.signals.join(" "), /could still add a form after the page loads/);
  });

  test("pages with forms in the HTML report forms_present", () => {
    assert.equal(jsRenderingEvidence(page(`<div id="root"><form><input name="a"></form></div>`)).assessment, "forms_present");
  });
});
