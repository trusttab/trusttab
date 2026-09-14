import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { manifests, sites, verificationRuns } from "@/db/schema";

export function isManifestExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() < now.getTime();
}

export async function getLatestVerificationRun(siteId: string) {
  const [row] = await db
    .select()
    .from(verificationRuns)
    .where(eq(verificationRuns.siteId, siteId))
    .orderBy(desc(verificationRuns.runAt))
    .limit(1);
  return row;
}

/** Latest manifest row for a site (any owner state), or undefined. */
export async function getLatestManifest(siteId: string) {
  const [row] = await db
    .select()
    .from(manifests)
    .where(eq(manifests.siteId, siteId))
    .orderBy(desc(manifests.version))
    .limit(1);
  return row;
}

/**
 * The live public manifest for a domain: the latest version published by the
 * account holding the *verified* claim on that domain. Pending claims by other
 * accounts are never served.
 */
export async function getLiveManifestForDomain(domain: string) {
  const [row] = await db
    .select({ manifest: manifests })
    .from(manifests)
    .innerJoin(sites, eq(manifests.siteId, sites.id))
    .where(and(eq(sites.domain, domain), isNotNull(sites.ownershipVerifiedAt)))
    .orderBy(desc(manifests.version))
    .limit(1);
  return row?.manifest;
}
