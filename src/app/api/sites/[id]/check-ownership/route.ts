import { and, eq, isNotNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { getApiUser, isUniqueViolation, isUuid, jsonError } from "@/lib/api";
import { checkDomainOwnership } from "@/lib/ownership";

// Outbound fetches can take a few seconds; give the function headroom.
export const maxDuration = 30;

/**
 * POST /api/sites/:id/check-ownership
 *
 * Fetches the site's homepage and looks for its verification meta tag. On
 * success, stamps `ownership_verified_at`. Responds with
 * `{ verified, reason?, checkedUrl?, ownershipVerifiedAt }`.
 *
 * A failed check does not un-verify a site that was previously verified; that
 * decision belongs to the re-verification flow (Day 3+).
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/sites/[id]/check-ownership">) {
  const user = await getApiUser();
  if (!user) return jsonError(401, "Sign in first.");

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Site not found.");

  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.userId, user.id)));
  if (!site) return jsonError(404, "Site not found.");

  if (site.ownershipVerifiedAt) {
    return NextResponse.json({ verified: true, ownershipVerifiedAt: site.ownershipVerifiedAt });
  }

  // Fail fast with a clear message instead of a unique-index error after the fetch.
  const [otherOwner] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.domain, site.domain), isNotNull(sites.ownershipVerifiedAt), ne(sites.id, site.id)));
  if (otherOwner) {
    return jsonError(409, `${site.domain} is already verified by another TrustTab account.`);
  }

  const result = await checkDomainOwnership(site.domain, site.verificationToken);
  if (!result.verified) {
    return NextResponse.json({
      verified: false,
      reason: result.reason,
      checkedUrl: result.checkedUrl,
      ownershipVerifiedAt: null,
    });
  }

  try {
    const [updated] = await db
      .update(sites)
      .set({ ownershipVerifiedAt: new Date() })
      .where(eq(sites.id, site.id))
      .returning({ ownershipVerifiedAt: sites.ownershipVerifiedAt });
    return NextResponse.json({
      verified: true,
      checkedUrl: result.checkedUrl,
      ownershipVerifiedAt: updated.ownershipVerifiedAt,
    });
  } catch (err) {
    // Lost a race with another account verifying the same domain.
    if (isUniqueViolation(err)) {
      return jsonError(409, `${site.domain} is already verified by another TrustTab account.`);
    }
    throw err;
  }
}
