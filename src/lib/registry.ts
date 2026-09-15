import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { sites } from "@/db/schema";

import { getLatestManifest, isManifestExpired } from "./manifest/queries";

/**
 * Public registry status for a site, as reported by /api/verify, the badge
 * and the public verification page.
 *
 * `expired` is derived, not stored: a site whose last run passed (verified or
 * self-declared) but whose current manifest has passed `expires_at` is no
 * longer vouched for.
 */
export type PublicStatus = "verified" | "self_declared" | "pending" | "needs_fix" | "failed" | "expired";

export type RegistryEntry = {
  siteId: string;
  verificationId: string;
  domain: string;
  status: PublicStatus;
  verifiedAt: Date | null;
  expiresAt: Date | null;
  /** Endpoints vouched for only by the owner's self-attestation, not by TrustTab. */
  selfDeclaredEndpoints: { method: string; path: string; purpose: string }[];
};

const VERIFICATION_ID_RE = /^tt_[a-z0-9]{8,32}$/;

type SiteRow = typeof sites.$inferSelect;

/** Looks up a site by its public `tt_…` ID. Returns null if unknown. */
export async function lookupRegistryEntry(verificationId: string, now = new Date()): Promise<RegistryEntry | null> {
  if (!VERIFICATION_ID_RE.test(verificationId)) return null;
  const [site] = await db.select().from(sites).where(eq(sites.verificationId, verificationId));
  return site ? entryForSite(site, now) : null;
}

/**
 * Looks up a site by domain, for clients that only know the site they're on
 * (the browser extension). `domain` must already be normalized with
 * normalizeDomain. Only the account holding the verified claim counts, and
 * only exact matches: a subdomain doesn't inherit its parent's entry.
 */
export async function lookupRegistryEntryByDomain(domain: string, now = new Date()): Promise<RegistryEntry | null> {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.domain, domain), isNotNull(sites.ownershipVerifiedAt)));
  return site ? entryForSite(site, now) : null;
}

/** The registry view of a site, shared by both lookups. */
async function entryForSite(site: SiteRow, now: Date): Promise<RegistryEntry | null> {
  // An entry only exists while the site holds a verified claim and has
  // published (which assigns the public ID).
  if (!site.ownershipVerifiedAt || !site.verificationId) return null;

  const manifest = await getLatestManifest(site.id);
  const expired = manifest ? isManifestExpired(manifest.expiresAt, now) : false;

  return {
    siteId: site.id,
    verificationId: site.verificationId,
    domain: site.domain,
    status: (site.status === "verified" || site.status === "self_declared") && expired ? "expired" : site.status,
    verifiedAt: manifest?.verifiedAt ?? null,
    expiresAt: manifest?.expiresAt ?? null,
    selfDeclaredEndpoints: (manifest?.payloadJson.endpoints ?? [])
      .filter((e) => e.verified_by === "owner")
      .map(({ method, path, purpose }) => ({ method, path, purpose })),
  };
}

/** Headers for public registry responses (both lookup routes). */
export const REGISTRY_RESPONSE_HEADERS = {
  "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff",
  // `private`: browser cache only. A shared/CDN cache would hide requests
  // from the rate limiter and the traffic log.
  "cache-control": "private, max-age=60",
};

/**
 * The public JSON for a registry entry, shared by GET /api/verify/:id and
 * GET /api/verify/by-domain/:domain so the two can't drift apart.
 */
export function registryEntryJson(entry: RegistryEntry, issuer: { name: string; url: string }) {
  return {
    verification_id: entry.verificationId,
    status: entry.status,
    domain: entry.domain,
    verified_at: entry.verifiedAt?.toISOString() ?? null,
    expires_at: entry.expiresAt?.toISOString() ?? null,
    issuer: { name: issuer.name, url: issuer.url },
    manifest_url: `${issuer.url}/api/manifest/${entry.domain}`,
    self_declared_endpoints: entry.selfDeclaredEndpoints,
  };
}
