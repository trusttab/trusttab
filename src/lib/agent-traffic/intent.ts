import { PURPOSES, type Purpose } from "@/lib/manifest/types";

/**
 * Declared intent: an agent states which of a site's published endpoint
 * purposes it is here to use, bound into its Web Bot Auth signature.
 *
 * The declaration travels in an `Intent-Declaration` header that the agent
 * includes in the signature's covered components, so altering or removing it
 * after signing breaks the signature (verified in intent.test.ts). A
 * declaration that was *not* covered by the signature is ignored entirely:
 * anyone can append a header to someone else's signed request, and an
 * unsigned declaration sitting beside a signed identity would look more
 * trustworthy than it is.
 *
 * The vocabulary is the manifest's own `purpose` taxonomy
 * (agent-trust.schema.json), not a second one, so the site's "here is what my
 * endpoints are for" and the agent's "here is what I'm here to do" speak the
 * same language.
 *
 * Declaring is optional. Signed traffic with no declaration is ordinary and
 * is never treated as worse than traffic with one.
 */

export const INTENT_HEADER = "intent-declaration";

const MAX_HEADER_CHARS = 400;
const MAX_SCOPES = 10;
const MAX_SCOPE_CHARS = 200;

export type IntentDeclaration = {
  /** Purposes from the manifest taxonomy. Unknown values are dropped. */
  purposes: Purpose[];
  /** Path prefixes the agent says it will stay within. Empty means it named none. */
  scopes: string[];
};

/**
 * Parses `purpose="booking"; scope="/schedule-tour"`. Repeated keys are
 * allowed (`purpose="booking"; purpose="quote_request"`), values may be
 * quoted or bare, and unknown keys and purposes are ignored rather than
 * making the whole declaration invalid.
 */
export function parseIntentDeclaration(header: string | null | undefined): IntentDeclaration | null {
  if (typeof header !== "string" || header.length === 0 || header.length > MAX_HEADER_CHARS) return null;

  const purposes: Purpose[] = [];
  const scopes: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (!value) continue;

    if (key === "purpose" && (PURPOSES as readonly string[]).includes(value) && !purposes.includes(value as Purpose)) {
      purposes.push(value as Purpose);
    } else if (key === "scope" && value.startsWith("/") && value.length <= MAX_SCOPE_CHARS && !scopes.includes(value)) {
      if (scopes.length < MAX_SCOPES) scopes.push(value);
    }
  }

  return purposes.length === 0 && scopes.length === 0 ? null : { purposes, scopes };
}

/** How a declaration reads in the dashboard. */
export function formatDeclaration(declaration: IntentDeclaration): string {
  const parts = [
    declaration.purposes.length > 0 ? declaration.purposes.join(", ") : null,
    declaration.scopes.length > 0 ? declaration.scopes.join(", ") : null,
  ].filter(Boolean);
  return parts.join(" under ");
}

export type ScopeMismatch = {
  declared: string;
  observedPath: string;
  /** The purpose the site itself publishes for the observed path, when it publishes one. */
  observedPurpose: Purpose | null;
  reason: "path-outside-scope" | "purpose-not-declared";
};

/** One of the site's published endpoints, as the manifest declares it. */
export type PublishedEndpoint = { path: string; purpose: Purpose };

function withinScopes(path: string, scopes: string[]): boolean {
  return scopes.some((scope) => path === scope || path.startsWith(scope.endsWith("/") ? scope : `${scope}/`));
}

/**
 * Compares what an agent declared with the request it actually made. Reports
 * only the fact of falling outside the declaration, and only when the
 * declaration says something to compare against:
 *
 * - scopes declared, path outside all of them → "path-outside-scope"
 * - purposes declared, and the site publishes a different purpose for the
 *   path it requested → "purpose-not-declared"
 *
 * Anything else is null: no declaration, nothing declared to compare, or a
 * path the site publishes nothing about (most of a site is not in its
 * manifest, and requesting an undeclared page is not a mismatch).
 */
export function findScopeMismatch(
  declaration: IntentDeclaration | null,
  observedPath: string,
  endpoints: PublishedEndpoint[] = [],
): ScopeMismatch | null {
  if (!declaration) return null;
  const path = observedPath.split(/[?#]/)[0] || "/";
  const published = endpoints.find((endpoint) => endpoint.path === path) ?? null;

  if (declaration.scopes.length > 0 && !withinScopes(path, declaration.scopes)) {
    return {
      declared: formatDeclaration(declaration),
      observedPath: path,
      observedPurpose: published?.purpose ?? null,
      reason: "path-outside-scope",
    };
  }

  if (declaration.purposes.length > 0 && published && !declaration.purposes.includes(published.purpose)) {
    return {
      declared: formatDeclaration(declaration),
      observedPath: path,
      observedPurpose: published.purpose,
      reason: "purpose-not-declared",
    };
  }

  return null;
}

/**
 * The wording for a mismatch: what was declared, what was observed, and
 * nothing more. A mismatch is a fact the owner can act on, not a finding
 * about the agent's intent — a misconfigured crawler and a deliberate one
 * look identical here, and this can't tell them apart.
 */
export function describeMismatch(mismatch: ScopeMismatch): { title: string; detail: string } {
  const observed =
    mismatch.reason === "purpose-not-declared" && mismatch.observedPurpose
      ? `${mismatch.observedPath}, which this site publishes as ${mismatch.observedPurpose}`
      : mismatch.observedPath;
  return {
    title: `Declared ${mismatch.declared}; requested ${observed}`,
    detail:
      mismatch.reason === "path-outside-scope"
        ? "The request falls outside the scope the agent declared. That can be a misconfigured agent, a redirect, or a deliberate deviation; this records the difference, not the reason."
        : "The purpose this site publishes for that path isn't one the agent declared. That can be a misconfigured agent or a deliberate deviation; this records the difference, not the reason.",
  };
}
