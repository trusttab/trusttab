import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { manifestEndpoints, manifests } from "@/db/schema";

import type { Manifest } from "./types";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Stores a signed manifest as the site's next version, with its endpoints.
 * Must run inside a transaction. A concurrent insert for the same site raises
 * a unique violation on (site_id, version); callers should surface a retry.
 */
export async function insertManifestVersion(tx: Tx, siteId: string, manifest: Manifest) {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${manifests.version}), 0) + 1` })
    .from(manifests)
    .where(eq(manifests.siteId, siteId));

  const [row] = await tx
    .insert(manifests)
    .values({
      siteId,
      version: next,
      payloadJson: manifest,
      signature: manifest.site.signature,
      verifiedAt: manifest.site.verified_at ? new Date(manifest.site.verified_at) : null,
      expiresAt: new Date(manifest.site.expires_at),
    })
    .returning({ id: manifests.id, version: manifests.version });

  await tx.insert(manifestEndpoints).values(
    manifest.endpoints.map((e) => ({
      manifestId: row.id,
      path: e.path,
      method: e.method,
      purpose: e.purpose,
      schemaJson: e.schema,
      agentSafe: e.agent_safe,
      requiresCaptcha: e.requires_captcha,
    })),
  );
  return row;
}
