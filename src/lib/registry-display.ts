/**
 * How a registry lookup is presented to people outside the dashboard, starting
 * with the browser extension. Pure and browser-safe (no server imports), so the
 * extension bundles the same wording the app would use.
 *
 * Display rules (agreed for the extension):
 * - Only "verified" is shown as Verified.
 * - "self_declared" gets its own state; it must never look like Verified.
 * - needs_fix, expired and failed show as "Needs re-check". A failed injection
 *   scan keeps an explicit finding rather than hiding behind the generic label.
 * - pending and not_found show as "Not verified", which is neutral: no badge
 *   is an unknown, not a negative claim about the site.
 */

export type RegistryStatus = "verified" | "self_declared" | "pending" | "needs_fix" | "failed" | "expired";

export type RegistryResponse = {
  verification_id: string;
  status: RegistryStatus;
  domain: string;
  verified_at: string | null;
  expires_at: string | null;
  self_declared_endpoints: { method: string; path: string; purpose: string }[];
};

const STATUSES: readonly string[] = ["verified", "self_declared", "pending", "needs_fix", "failed", "expired"];

/**
 * Validates a 200 response body from /api/verify/*. Returns null if anything is
 * off, so the caller shows "couldn't check" rather than rendering unexpected data.
 */
export function parseRegistryResponse(body: unknown): RegistryResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const isDateOrNull = (v: unknown) => v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));
  if (
    typeof b.verification_id !== "string" ||
    !/^tt_[a-z0-9]{8,32}$/.test(b.verification_id) ||
    typeof b.status !== "string" ||
    !STATUSES.includes(b.status) ||
    typeof b.domain !== "string" ||
    !isDateOrNull(b.verified_at) ||
    !isDateOrNull(b.expires_at)
  ) {
    return null;
  }
  const endpoints = Array.isArray(b.self_declared_endpoints) ? b.self_declared_endpoints : [];
  return {
    verification_id: b.verification_id,
    status: b.status as RegistryStatus,
    domain: b.domain,
    verified_at: b.verified_at as string | null,
    expires_at: b.expires_at as string | null,
    self_declared_endpoints: endpoints
      .filter(
        (e): e is { method: string; path: string; purpose: string } =>
          typeof e === "object" && e !== null && ["method", "path", "purpose"].every((k) => typeof (e as Record<string, unknown>)[k] === "string"),
      )
      .slice(0, 50)
      .map(({ method, path, purpose }) => ({ method, path, purpose })),
  };
}

export type DisplayTone = "verified" | "self_declared" | "recheck" | "unknown";

export type RegistryDisplay = {
  tone: DisplayTone;
  title: string;
  summary: string;
  /** A specific negative finding that must stay visible (currently: injection content). */
  finding?: string;
  /** Short factual lines: dates, forms declared by the owner. */
  facts: string[];
};

export type LookupOutcome =
  | { kind: "entry"; entry: RegistryResponse }
  | { kind: "not_found" }
  | { kind: "not_applicable"; reason: string }
  | { kind: "error"; message: string };

export function describeLookup(outcome: LookupOutcome, formatDate: (iso: string) => string): RegistryDisplay {
  switch (outcome.kind) {
    case "not_found":
      return {
        tone: "unknown",
        title: "Not verified",
        summary: "TrustTab has no verification for this site. That isn't a warning, just an unknown.",
        facts: [],
      };
    case "not_applicable":
      return { tone: "unknown", title: "Nothing to check", summary: outcome.reason, facts: [] };
    case "error":
      return { tone: "unknown", title: "Couldn't check", summary: outcome.message, facts: [] };
    case "entry":
      return describeEntry(outcome.entry, formatDate);
  }
}

function describeEntry(entry: RegistryResponse, formatDate: (iso: string) => string): RegistryDisplay {
  const dates: string[] = [];
  if (entry.verified_at) dates.push(`Verified ${formatDate(entry.verified_at)}`);
  if (entry.expires_at && (entry.status === "verified" || entry.status === "self_declared")) {
    dates.push(`Valid until ${formatDate(entry.expires_at)}`);
  }

  switch (entry.status) {
    case "verified":
      return {
        tone: "verified",
        title: "Verified",
        summary: "TrustTab checked that this site's declared forms exist as described and found no hidden content aimed at AI agents.",
        facts: dates,
      };
    case "self_declared":
      return {
        tone: "self_declared",
        title: "Self-declared",
        summary:
          "TrustTab's automated checks passed, but some forms couldn't be checked automatically. The site owner declares them; TrustTab hasn't confirmed them.",
        facts: [
          ...dates,
          ...entry.self_declared_endpoints.map((e) => `Declared by the owner, not confirmed: ${e.method} ${e.path} (${e.purpose})`),
        ],
      };
    case "needs_fix":
      return {
        tone: "recheck",
        title: "Needs re-check",
        summary: "This site has a TrustTab manifest, but some of its checks aren't passing right now.",
        facts: [],
      };
    case "expired":
      return {
        tone: "recheck",
        title: "Needs re-check",
        summary: "This site's TrustTab verification has expired and hasn't been renewed.",
        facts: dates,
      };
    case "failed":
      return {
        tone: "recheck",
        title: "Needs re-check",
        summary: "This site has a TrustTab manifest, but its latest check didn't pass.",
        finding: "A check found content on this site that could mislead AI agents.",
        facts: [],
      };
    case "pending":
      return {
        tone: "unknown",
        title: "Not verified",
        summary: "This site has published a TrustTab manifest that hasn't been checked yet.",
        facts: [],
      };
  }
}
