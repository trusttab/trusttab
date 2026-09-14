/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Signatures are computed over bytes, so signer and verifier must serialize a
 * manifest identically. JCS defines that serialization: object keys sorted by
 * UTF-16 code units, no insignificant whitespace, and ECMAScript number and
 * string formatting — which is exactly what `JSON.stringify` produces for
 * individual primitives. Any JCS implementation in any language will produce
 * the same output, so third parties can verify TrustTab signatures.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS cannot encode non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      // Default sort compares UTF-16 code units, as RFC 8785 §3.2.3 requires.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new TypeError(`JCS cannot encode values of type ${typeof value}`);
}
