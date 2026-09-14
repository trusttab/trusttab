import "server-only";

import { eq } from "drizzle-orm";

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

/** Looks up a site by its public `tt_…` ID. Returns null if unknown. */
export async function lookupRegistryEntry(verificationId: string, now = new Date()): Promise<RegistryEntry | null> {
  if (!VERIFICATION_ID_RE.test(verificationId)) return null;

  const [site] = await db.select().from(sites).where(eq(sites.verificationId, verificationId));
  // A verification ID is only meaningful while its site holds a verified claim.
  if (!site || !site.ownershipVerifiedAt) return null;

  const manifest = await getLatestManifest(site.id);
  const expired = manifest ? isManifestExpired(manifest.expiresAt, now) : false;

  return {
    siteId: site.id,
    verificationId,
    domain: site.domain,
    status: (site.status === "verified" || site.status === "self_declared") && expired ? "expired" : site.status,
    verifiedAt: manifest?.verifiedAt ?? null,
    expiresAt: manifest?.expiresAt ?? null,
    selfDeclaredEndpoints: (manifest?.payloadJson.endpoints ?? [])
      .filter((e) => e.verified_by === "owner")
      .map(({ method, path, purpose }) => ({ method, path, purpose })),
  };
}
