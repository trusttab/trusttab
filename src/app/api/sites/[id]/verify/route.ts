import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { sites, verificationRuns } from "@/db/schema";
import { getApiUser, isUniqueViolation, isUuid, jsonError } from "@/lib/api";
import { reissueManifest } from "@/lib/manifest/build";
import { getLatestManifest } from "@/lib/manifest/queries";
import { signManifest } from "@/lib/manifest/signing";
import { insertManifestVersion } from "@/lib/manifest/store";
import { validateManifest } from "@/lib/manifest/validate";
import { runVerification } from "@/lib/verification/engine";

// Up to 50 endpoint pages plus the homepage and well-known manifest are fetched.
export const maxDuration = 60;

/** Minimum time between runs for one site, to limit outbound fetches. */
const COOLDOWN_MS = 20_000;

/**
 * POST /api/sites/:id/verify — "Re-check now".
 *
 * Runs every verification check against the live site, records a
 * verification_runs row, and updates `sites.status`:
 *   - verified  — every check passed
 *   - failed    — the injection scan found manipulative content
 *   - needs_fix — anything else failed (missing fields, manifest not served…)
 *
 * The site's manifest is then re-issued as a new signed version reflecting
 * the outcome (`site.verified_at`, `content_scan`, fresh expiry), so the
 * public manifest never claims more than the latest run established.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/sites/[id]/verify">) {
  const user = await getApiUser();
  if (!user) return jsonError(401, "Sign in first.");

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Site not found.");

  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.userId, user.id)));
  if (!site) return jsonError(404, "Site not found.");
  if (!site.ownershipVerifiedAt) return jsonError(403, "Verify ownership of this domain first.");

  const latest = await getLatestManifest(site.id);
  if (!latest || !site.verificationId) return jsonError(409, "Publish a manifest before running verification.");

  const [lastRun] = await db
    .select({ runAt: verificationRuns.runAt })
    .from(verificationRuns)
    .where(eq(verificationRuns.siteId, site.id))
    .orderBy(desc(verificationRuns.runAt))
    .limit(1);
  const waitMs = lastRun ? COOLDOWN_MS - (Date.now() - lastRun.runAt.getTime()) : 0;
  if (waitMs > 0) {
    return jsonError(429, `Please wait ${Math.ceil(waitMs / 1000)}s before re-checking.`);
  }

  const outcome = await runVerification({
    domain: site.domain,
    verificationId: site.verificationId,
    manifest: latest.payloadJson,
  });

  const scanCheck = outcome.results.checks.find((c) => c.id === "injection_scan")!;
  const reissued = signManifest(
    reissueManifest(latest.payloadJson, {
      verified: outcome.passed,
      scanStatus: outcome.injectionDetected ? "failed" : scanCheck.passed ? "passed" : "pending",
    }),
  );
  const invalid = validateManifest(reissued);
  if (invalid.length > 0) {
    // Only possible if the schema or issuer config changed since publishing.
    return NextResponse.json({ error: "Re-issued manifest failed validation.", details: invalid }, { status: 500 });
  }

  const status = outcome.passed ? "verified" : outcome.injectionDetected ? "failed" : "needs_fix";

  try {
    const run = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(verificationRuns)
        .values({ siteId: site.id, manifestId: latest.id, passed: outcome.passed, resultsJson: outcome.results })
        .returning();
      await insertManifestVersion(tx, site.id, reissued);
      await tx.update(sites).set({ status }).where(eq(sites.id, site.id));
      return row;
    });
    return NextResponse.json({ status, passed: run.passed, runAt: run.runAt, results: run.resultsJson });
  } catch (err) {
    if (isUniqueViolation(err)) return jsonError(409, "The manifest changed during verification. Please re-check.");
    throw err;
  }
}
