import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import schema from "../../../agent-trust.schema.json";
import { formControls } from "./form-match";

/**
 * Extracts the forms on a page as manifest-ready field declarations, for the
 * dashboard assistant's draft proposals. Pure: HTML in, structure out.
 *
 * Only facts from the HTML are used. Field names come from `name`, and types
 * from the control: `type="email"` → email, `type="tel"` → phone, `<select>` →
 * enum of its option values, a missing `required` → optional (`?`). Anything
 * the manifest schema can't express (odd names, enum values with spaces) falls
 * back to the plain `string` type or is skipped, never guessed.
 */

export type ExtractedField = {
  name: string;
  /** A valid manifest field type expression, e.g. "email" or "enum[a,b]?". */
  type: string;
  /** Short visible label, if any (at most 60 characters). Untrusted page text. */
  label?: string;
};

export type ExtractedForm = {
  method: "GET" | "POST";
  /** The form's `action` attribute, if present. */
  action?: string;
  fields: ExtractedField[];
};

const FIELD_TYPE_RE = new RegExp(schema.$defs.fieldType.pattern);
const ENUM_VALUE_RE = /^[A-Za-z0-9_-]+$/;
const SKIPPED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);
const MAX_ENUM_VALUES = 50;
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

export function extractForms(html: string): ExtractedForm[] {
  const $ = cheerio.load(html);
  return $("form")
    .toArray()
    .map((form): ExtractedForm => {
      const byName = new Map<string, AnyNode[]>();
      for (const el of formControls($, form)) {
        const name = $(el).attr("name")!;
        if (!/^\S{1,100}$/.test(name)) continue;
        byName.set(name, [...(byName.get(name) ?? []), el]);
      }

      const fields: ExtractedField[] = [];
      for (const [name, els] of byName) {
        const type = fieldType($, els);
        if (!type || !FIELD_TYPE_RE.test(type)) continue;
        const label = labelFor($, els[0]);
        fields.push(label ? { name, type, label } : { name, type });
      }

      const method = ($(form).attr("method") ?? "get").toUpperCase() === "POST" ? "POST" : "GET";
      const action = $(form).attr("action")?.slice(0, 200);
      return action ? { method, action, fields } : { method, fields };
    })
    .filter((f) => f.fields.length > 0);
}

/**
 * True when a page looks like an app shell whose content is rendered by
 * client-side JavaScript: no forms, very little server-rendered text, and a
 * typical mount point or module script. A hint only, and always worded as
 * "looks like" wherever it's shown.
 */
export function looksClientRendered(html: string): boolean {
  const $ = cheerio.load(html);
  if ($("form").length > 0) return false;
  const hasMountPoint = $("#root, #app, #__next, #__nuxt, [data-reactroot]").length > 0;
  const hasModuleScript = $('script[type="module"], script[src*="/assets/index-"]').length > 0;
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.length < 300 && (hasMountPoint || hasModuleScript);
}

function fieldType($: cheerio.CheerioAPI, els: AnyNode[]): string | null {
  const first = $(els[0]);
  const tag = (els[0] as { tagName?: string }).tagName?.toLowerCase();
  const required = els.some((el) => $(el).is("[required]"));
  const optional = required ? "" : "?";

  if (tag === "textarea") return `string${optional}`;
  if (tag === "button") return null;
  if (tag === "select") {
    const values = first
      .find("option")
      .toArray()
      .map((o) => ($(o).attr("value") ?? $(o).text()).trim())
      .filter((v) => v !== "");
    if (first.is("[multiple]")) return `array<string>${optional}`;
    return `${enumOf(values) ?? "string"}${optional}`;
  }

  const inputType = (first.attr("type") ?? "text").toLowerCase();
  if (SKIPPED_INPUT_TYPES.has(inputType)) return null;
  switch (inputType) {
    case "email":
      return `email${optional}`;
    case "tel":
      return `phone${optional}`;
    case "url":
      return `url${optional}`;
    case "number":
    case "range":
      return `number${optional}`;
    case "date":
    case "datetime-local":
      return `date${optional}`;
    case "file":
      return first.is("[multiple]") ? `array<file>${optional}` : `file${optional}`;
    case "radio":
      return `${enumOf(els.map((el) => ($(el).attr("value") ?? "").trim())) ?? "string"}${optional}`;
    case "checkbox":
      return els.length > 1 ? `array<string>${optional}` : `boolean${optional}`;
    default:
      return `string${optional}`;
  }
}

function enumOf(values: string[]): string | null {
  const unique = [...new Set(values)];
  if (unique.length === 0 || unique.length > MAX_ENUM_VALUES) return null;
  if (!unique.every((v) => ENUM_VALUE_RE.test(v))) return null;
  return `enum[${unique.join(",")}]`;
}

function labelFor($: cheerio.CheerioAPI, el: AnyNode): string | undefined {
  const $el = $(el);
  const id = $el.attr("id");
  const text =
    (id && $(`label[for="${id.replace(/"/g, "")}"]`).first().text()) ||
    $el.closest("label").text() ||
    $el.attr("aria-label") ||
    $el.attr("placeholder") ||
    "";
  const clean = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 60) : undefined;
}
