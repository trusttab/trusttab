import "server-only";

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { manifestHits, manifests, sites, verificationRuns } from "@/db/schema";

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

/** Most recent public-endpoint hits for a site, plus 7-day counts per endpoint. */
export async function getTraffic(siteId: string, limit = 50) {
  const [hits, counts] = await Promise.all([
    db.select().from(manifestHits).where(eq(manifestHits.siteId, siteId)).orderBy(desc(manifestHits.createdAt)).limit(limit),
    db
      .select({ endpoint: manifestHits.endpoint, count: sql<number>`count(*)::int` })
      .from(manifestHits)
      .where(and(eq(manifestHits.siteId, siteId), gte(manifestHits.createdAt, sql`now() - interval '7 days'`)))
      .groupBy(manifestHits.endpoint),
  ]);
  const byEndpoint = Object.fromEntries(counts.map((c) => [c.endpoint, c.count]));
  return { hits, counts: { manifest: byEndpoint.manifest ?? 0, verify: byEndpoint.verify ?? 0 } };
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
