import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { getApiSession, isUuid, jsonError } from "@/lib/api";
import { getOrCreateDraft } from "@/lib/drafts";
import { issuePublishConfirmation, sameOriginBrowserRequestError } from "@/lib/publish-gate";

/**
 * POST /api/sites/:id/publish/confirm — step 1 of the human publish flow.
 *
 * Body: `{ draftHash }`, the hash of the draft the owner reviewed. Returns a
 * single-use confirmation (valid two minutes) for publishing exactly that
 * draft from this session. See src/lib/publish-gate.ts for the guarantees.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/publish/confirm">) {
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
  if (!site.ownershipVerifiedAt) return jsonError(403, "Verify ownership of this domain before publishing.");

  const body = (await request.json().catch(() => null)) as { draftHash?: unknown } | null;
  if (typeof body?.draftHash !== "string") return jsonError(400, "draftHash is required.");

  const draft = await getOrCreateDraft(site.id);
  if (draft.hash !== body.draftHash) {
    return NextResponse.json(
      { error: "The draft changed since you reviewed it. Review the latest changes before publishing." },
      { status: 409 },
    );
  }

  const { token, expiresAt } = await issuePublishConfirmation({
    userId: auth.user.id,
    sessionId: auth.sessionId,
    siteId: site.id,
    draftHash: draft.hash,
  });
  return NextResponse.json({ confirmation: token, expiresAt }, { headers: { "cache-control": "no-store" } });
}
