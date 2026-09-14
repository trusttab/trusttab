/**
 * The dashboard edits an endpoint's field schema as plain text, one field per
 * line:
 *
 *   email: email
 *   message: string?
 *   service: enum[repair,install]
 *
 * These helpers convert between that text and the manifest's
 * `{ name: typeExpression }` object. They only split lines — whether a type
 * expression is valid is decided by agent-trust.schema.json on the server.
 */

export function fieldsToText(schema: Record<string, string>): string {
  return Object.entries(schema)
    .map(([name, type]) => `${name}: ${type}`)
    .join("\n");
}

export type ParsedFields =
  | { ok: true; schema: Record<string, string> }
  | { ok: false; error: string };

export function textToFields(text: string): ParsedFields {
  const schema: Record<string, string> = {};
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const [i, line] of lines.entries()) {
    const colon = line.indexOf(":");
    if (colon === -1) {
      return { ok: false, error: `Line ${i + 1}: expected "name: type", got "${line}"` };
    }
    const name = line.slice(0, colon).trim();
    // Whitespace inside enum lists ("enum[a, b]") is forgiven.
    const type = line.slice(colon + 1).replace(/\s+/g, "");
    if (!name || !type) {
      return { ok: false, error: `Line ${i + 1}: expected "name: type", got "${line}"` };
    }
    if (name in schema) return { ok: false, error: `Field "${name}" is listed twice` };
    schema[name] = type;
  }
  return { ok: true, schema };
}
