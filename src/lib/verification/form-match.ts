import * as cheerio from "cheerio";

/**
 * Check 1 — endpoint existence + field match (pure: HTML in, verdict out).
 *
 * A declared endpoint passes if the page contains a `<form>` whose control
 * names are a superset of the declared field names. Every declared field
 * counts, including optional (`?`) ones: optional means an agent may leave it
 * blank, not that the form may lack it.
 *
 * Deliberately lenient about `method`: many forms are submitted by JavaScript
 * and have no `method` attribute (which HTML treats as GET). A mismatch is
 * reported as a note, not a failure, so it doesn't fail otherwise-correct sites.
 *
 * Known limitation: only forms present in the server-rendered HTML are seen.
 * Forms rendered entirely client-side will not be found.
 */

export type FormMatchResult = {
  passed: boolean;
  message: string;
  /** Declared fields missing from the closest-matching form (empty on pass). */
  missingFields: string[];
  note?: string;
};

type FormInfo = { names: Set<string>; method: string; index: number };

function collectForms(html: string): FormInfo[] {
  const $ = cheerio.load(html);
  const controls = "input[name], select[name], textarea[name], button[name]";

  return $("form")
    .toArray()
    .map((form, index) => {
      const names = new Set<string>();
      $(form)
        .find(controls)
        .each((_, el) => void names.add($(el).attr("name")!));
      // Controls outside the form can join it via the `form="<id>"` attribute.
      const id = $(form).attr("id");
      if (id) {
        $(controls)
          .filter((_, el) => $(el).attr("form") === id)
          .each((_, el) => void names.add($(el).attr("name")!));
      }
      return { names, method: ($(form).attr("method") ?? "get").toUpperCase(), index };
    });
}

export function matchForm(html: string, declaredFields: string[], declaredMethod: string): FormMatchResult {
  const forms = collectForms(html);
  if (forms.length === 0) {
    return {
      passed: false,
      message: "No <form> found on the page. (Forms rendered only by client-side JavaScript can't be detected.)",
      missingFields: declaredFields,
    };
  }

  const missingFor = (form: FormInfo) => declaredFields.filter((f) => !form.names.has(f));
  const complete = forms.filter((f) => missingFor(f).length === 0);

  if (complete.length > 0) {
    const best = complete.find((f) => f.method === declaredMethod) ?? complete[0];
    return {
      passed: true,
      message: `Form #${best.index + 1} has all ${declaredFields.length} declared fields.`,
      missingFields: [],
      note:
        best.method === declaredMethod
          ? undefined
          : `The form's method is ${best.method}${best.method === "GET" ? " (or unset)" : ""}, but ${declaredMethod} was declared. Fine if the form is submitted by JavaScript.`,
    };
  }

  // Report against the form that came closest, so the owner knows what to fix.
  const closest = forms.reduce((a, b) => (missingFor(b).length < missingFor(a).length ? b : a));
  const missing = missingFor(closest);
  return {
    passed: false,
    message: `No form contains all declared fields. Closest (form #${closest.index + 1}) is missing: ${missing.join(", ")}.`,
    missingFields: missing,
  };
}
