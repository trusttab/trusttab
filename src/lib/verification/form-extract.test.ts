import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractForms, looksClientRendered } from "./form-extract";

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

  test("looksClientRendered only for formless app shells", () => {
    assert.equal(looksClientRendered(page(`<div id="root"></div><script type="module" src="/assets/index-abc.js"></script>`)), true);
    assert.equal(looksClientRendered(page(`<div id="root"><form><input name="a"></form></div>`)), false);
    assert.equal(looksClientRendered(page(`<main><h1>Plumbing</h1><p>${"Real server-rendered content. ".repeat(20)}</p></main>`)), false);
  });
});
