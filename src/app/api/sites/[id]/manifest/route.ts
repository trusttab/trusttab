import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { draftChanges, manifestDrafts, sites } from "@/db/schema";
import { getApiSession, isUniqueViolation, isUuid, jsonError } from "@/lib/api";
import { draftHash } from "@/lib/drafts";
import { buildManifest, generateVerificationId } from "@/lib/manifest/build";
import { signManifest } from "@/lib/manifest/signing";
import { insertManifestVersion } from "@/lib/manifest/store";
import type { ManifestInput } from "@/lib/manifest/types";
import { validateManifest } from "@/lib/manifest/validate";
import { consumePublishConfirmation, sameOriginBrowserRequestError } from "@/lib/publish-gate";

/**
 * POST /api/sites/:id/manifest — "Sign & publish manifest", step 2 of the
 * human-only publish flow (see src/lib/publish-gate.ts).
 *
 * Body: `{ draftHash, confirmation }`. There is deliberately no way to pass a
 * manifest in the request: the server signs the site's *stored draft*, and
 * only if
 *   - the request is a same-origin browser request from a signed-in session,
 *   - `confirmation` was issued to this user and session, for this site and
 *     this `draftHash`, is unexpired and unused, and
 *   - the stored draft still hashes to `draftHash`.
 *
 * TrustTab fills in issuer, domain, timestamps and scan status, signs, validates
 * the signed document against agent-trust.schema.json, stores it as the next
 * version, resets the site's status to "pending" and clears the assistant's
 * change log. Responds 201 with the manifest, 422 with validation details, or
 * 403/409 if the confirmation or draft doesn't match.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/manifest">) {
  const originError = sameOriginBrowserRequestError(request);
  if (originError) return jsonError(403, originError);

  const auth = await getApiSession();
  if (!auth) return jsonError(401, "Sign in first.");

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Site not found.");
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.userId, auth.user.id)));
  if (!site) return jsonError(404, "Site not found.");
  if (!site.ownershipVerifiedAt) {
    return jsonError(403, "Verify ownership of this domain before publishing a manifest.");
  }

  const body = (await request.json().catch(() => null)) as { draftHash?: unknown; confirmation?: unknown } | null;
  if (typeof body?.draftHash !== "string" || typeof body?.confirmation !== "string") {
    return jsonError(400, "Publishing requires draftHash and confirmation from the dashboard.");
  }
  const reviewedHash = body.draftHash;
  const confirmation = body.confirmation;

  // Assign the site's public registry ID on first publish. The conditional
  // update makes concurrent first publishes agree on a single ID.
  let verificationId = site.verificationId;
  if (!verificationId) {
    await db
      .update(sites)
      .set({ verificationId: generateVerificationId() })
      .where(and(eq(sites.id, site.id), isNull(sites.verificationId)));
    [{ verificationId }] = await db
      .select({ verificationId: sites.verificationId })
      .from(sites)
      .where(eq(sites.id, site.id));
  }

  class PublishRejected extends Error {
    constructor(public response: Response) {
      super("publish rejected");
    }
  }

  try {
    const saved = await db.transaction(async (tx) => {
      // Lock the draft so it can't change between the hash check and signing.
      const [draftRow] = await tx
        .select()
        .from(manifestDrafts)
        .where(eq(manifestDrafts.siteId, site.id))
        .for("update");
      if (!draftRow) throw new PublishRejected(jsonError(409, "There is no draft to publish."));

      const input = draftRow.inputJson as ManifestInput;
      if (draftHash(input) !== reviewedHash) {
        throw new PublishRejected(
          jsonError(409, "The draft changed since you reviewed it. Review the latest changes before publishing."),
        );
      }

      const confirmed = await consumePublishConfirmation(tx, {
        token: confirmation,
        userId: auth.user.id,
        sessionId: auth.sessionId,
        siteId: site.id,
        draftHash: reviewedHash,
      });
      if (!confirmed) {
        throw new PublishRejected(jsonError(403, "This publish confirmation is invalid, expired or already used. Try again."));
      }

      const manifest = signManifest(buildManifest({ domain: site.domain, verificationId: verificationId!, input }));
      const details = validateManifest(manifest);
      if (details.length > 0) {
        // Rolls back the transaction, so the confirmation isn't burned.
        throw new PublishRejected(NextResponse.json({ error: "Manifest is invalid.", details }, { status: 422 }));
      }

      const row = await insertManifestVersion(tx, site.id, manifest);
      // New declarations haven't been checked, so the site is no longer verified.
      await tx.update(sites).set({ status: "pending" }).where(eq(sites.id, site.id));
      // The owner has reviewed and published the assistant's changes.
      await tx.delete(draftChanges).where(eq(draftChanges.siteId, site.id));
      return { version: row.version, manifest };
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    if (err instanceof PublishRejected) return err.response;
    // Two publishes raced for the same version number.
    if (isUniqueViolation(err)) return jsonError(409, "Another publish just happened. Please retry.");
    throw err;
  }
}
