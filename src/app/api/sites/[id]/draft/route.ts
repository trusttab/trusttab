import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { getApiUser, isUuid, jsonError } from "@/lib/api";
import { DraftConflictError, getAssistantChanges, getOrCreateDraft, saveDraft } from "@/lib/drafts";

const MAX_BODY_BYTES = 200_000;

async function ownedVerifiedSite(id: string) {
  const user = await getApiUser();
  if (!user) return { error: jsonError(401, "Sign in first.") } as const;
  if (!isUuid(id)) return { error: jsonError(404, "Site not found.") } as const;
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.userId, user.id)));
  if (!site) return { error: jsonError(404, "Site not found.") } as const;
  if (!site.ownershipVerifiedAt) return { error: jsonError(403, "Verify ownership of this domain first.") } as const;
  return { site } as const;
}

/** GET /api/sites/:id/draft — the site's draft manifest and the assistant's changes since the last publish. */
export async function GET(_request: Request, ctx: RouteContext<"/api/sites/[id]/draft">) {
  const found = await ownedVerifiedSite((await ctx.params).id);
  if ("error" in found) return found.error;
  const [draft, changes] = await Promise.all([getOrCreateDraft(found.site.id), getAssistantChanges(found.site.id)]);
  return NextResponse.json({ draft, changes });
}

/**
 * PUT /api/sites/:id/draft — the owner saves the editor's state.
 * Body: `{ input: ManifestInput, baseVersion: number }`. 409 if the draft
 * changed since `baseVersion` (for example, the assistant edited it).
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/sites/[id]/draft">) {
  const found = await ownedVerifiedSite((await ctx.params).id);
  if ("error" in found) return found.error;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, "Draft is too large.");
  let body: { input?: unknown; baseVersion?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "Expected a JSON body.");
  }
  if (typeof body.baseVersion !== "number") return jsonError(400, "baseVersion is required.");

  await getOrCreateDraft(found.site.id);
  try {
    const draft = await saveDraft({ siteId: found.site.id, input: body.input, baseVersion: body.baseVersion, actor: "owner" });
    return NextResponse.json({ draft });
  } catch (err) {
    if (err instanceof DraftConflictError) {
      return NextResponse.json({ error: err.message, currentVersion: err.currentVersion }, { status: 409 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Draft is malformed.", details: err.issues.slice(0, 10) }, { status: 400 });
    }
    throw err;
  }
}
