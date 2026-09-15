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

export type JsRenderingEvidence = {
  /**
   * - "forms_present": the HTML contains forms; nothing to explain.
   * - "likely_js_rendered": no forms, and the page shows signs of a
   *   JavaScript app, a site builder or an embedded form widget.
   * - "possibly_js_rendered": no forms and no such signs. Still not ruled
   *   out, since scripts can inject forms in ways the HTML doesn't reveal.
   *
   * There is deliberately no "not JS-rendered" outcome. The two mistakes
   * aren't equally costly: wrongly suggesting self-attestation when a real
   * form exists is a minor detour, but wrongly ruling out JavaScript
   * rendering steers the owner away from the fallback built for exactly that
   * case. So ambiguous evidence leans toward JS-rendered.
   */
  assessment: "forms_present" | "likely_js_rendered" | "possibly_js_rendered";
  /** The observed facts behind the assessment, in plain words. */
  signals: string[];
};

const APP_MOUNT_POINTS = "#root, #app, #__next, #__nuxt, #___gatsby, #svelte, [data-reactroot], [ng-version]";
const BUNDLE_SCRIPT = /\/(assets|_next\/static|static\/js|build|dist)\/[^"']*\.m?js|\/index-[\w-]+\.js|\/main[.-][\w-]+\.js/i;
const FORM_EMBEDS: [RegExp, string][] = [
  [/hsforms|hubspot/i, "HubSpot"],
  [/typeform/i, "Typeform"],
  [/jotform/i, "Jotform"],
  [/calendly/i, "Calendly"],
  [/docs\.google\.com\/forms|forms\.gle/i, "Google Forms"],
  [/tally\.so/i, "Tally"],
  [/acuityscheduling/i, "Acuity"],
];
const SITE_BUILDERS: [RegExp, string][] = [
  [/base44/i, "Base44"],
  [/webflow/i, "Webflow"],
  [/wix(static)?\.com|wix\.com/i, "Wix"],
  [/squarespace/i, "Squarespace"],
  [/framer(usercontent)?\.com|framer\.website/i, "Framer"],
  [/shopify/i, "Shopify"],
];

/**
 * Explains why a page might have no forms in its HTML. Used by the dashboard
 * assistant to decide how to talk about a missing form. Observations only,
 * reported as signals, never as a verdict that JavaScript is not involved.
 */
export function jsRenderingEvidence(html: string): JsRenderingEvidence {
  const $ = cheerio.load(html);
  const formCount = $("form").length;
  if (formCount > 0) {
    return { assessment: "forms_present", signals: [`${formCount} form(s) in the server-rendered HTML`] };
  }

  const signals: string[] = [];
  const mounts = $(APP_MOUNT_POINTS).toArray().map((el) => $(el).attr("id") ?? "app root");
  if (mounts.length > 0) signals.push(`JavaScript app mount point (${[...new Set(mounts)].join(", ")})`);

  const scriptSrcs = $("script[src]").toArray().map((el) => $(el).attr("src") ?? "");
  const moduleScripts = $('script[type="module"]').length;
  const bundles = scriptSrcs.filter((src) => BUNDLE_SCRIPT.test(src)).length;
  if (moduleScripts > 0 || bundles > 0) signals.push(`JavaScript bundle scripts (${Math.max(moduleScripts, bundles)})`);

  const embedSources = [...scriptSrcs, ...$("iframe[src]").toArray().map((el) => $(el).attr("src") ?? "")].join(" ");
  const embeds = FORM_EMBEDS.filter(([re]) => re.test(embedSources)).map(([, name]) => name);
  if (embeds.length > 0) signals.push(`embedded form or booking widget (${embeds.join(", ")})`);

  const generator = $('meta[name="generator" i]').attr("content") ?? "";
  const builders = SITE_BUILDERS.filter(([re]) => re.test(`${generator} ${embedSources} ${$("link[href]").toArray().map((el) => $(el).attr("href")).join(" ")}`)).map(
    ([, name]) => name,
  );
  if (builders.length > 0) signals.push(`built with a site builder (${[...new Set(builders)].join(", ")})`);

  $("script, style, noscript, template").remove();
  const textChars = $("body").text().replace(/\s+/g, " ").trim().length;
  if (textChars > 0) {
    signals.push(
      `${textChars} characters of text in the HTML (site builders often pre-render text for search engines, so this doesn't mean the form is in the HTML)`,
    );
  }

  const likely = mounts.length > 0 || moduleScripts > 0 || bundles > 0 || embeds.length > 0 || builders.length > 0;
  if (!likely) signals.push("no signs of a JavaScript app, but scripts could still add a form after the page loads");
  return { assessment: likely ? "likely_js_rendered" : "possibly_js_rendered", signals };
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
