import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { ownerAgents, sites } from "@/db/schema";
import { MAX_OWNER_AGENTS_PER_SITE, validateOwnerAgent } from "@/lib/agent-traffic/owner-agents";
import { getApiUser, isUuid, jsonError } from "@/lib/api";
import { sameOriginBrowserRequestError } from "@/lib/same-origin";

/**
 * The owner's own agent labels for one site. Private to the account holding
 * the verified claim on that domain: the same ownership check the rest of the
 * dashboard uses, which 404s for everyone else. Nothing here appears on the
 * public registry, the badge, or in the extension.
 */
async function ownedSite(id: string) {
  const user = await getApiUser();
  if (!user) return { error: jsonError(401, "Sign in first.") } as const;
  if (!isUuid(id)) return { error: jsonError(404, "Site not found.") } as const;
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.userId, user.id)));
  if (!site) return { error: jsonError(404, "Site not found.") } as const;
  return { site } as const;
}

/** POST /api/sites/:id/owner-agents — register one of the owner's own agents. */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/owner-agents">) {
  const sameOrigin = sameOriginBrowserRequestError(request);
  if (sameOrigin) return jsonError(403, sameOrigin);

  const found = await ownedSite((await ctx.params).id);
  if ("error" in found) return found.error;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const validated = validateOwnerAgent(body ?? {});
  if (!validated.ok) return jsonError(400, validated.error);

  const existing = await db.select({ id: ownerAgents.id }).from(ownerAgents).where(eq(ownerAgents.siteId, found.site.id));
  if (existing.length >= MAX_OWNER_AGENTS_PER_SITE) {
    return jsonError(400, `You can register up to ${MAX_OWNER_AGENTS_PER_SITE} agents for a site.`);
  }

  const [created] = await db
    .insert(ownerAgents)
    .values({ siteId: found.site.id, ...validated.value })
    .returning();
  return NextResponse.json({ agent: created });
}

/** DELETE /api/sites/:id/owner-agents?agentId=… — remove one. Past traffic keeps the label it was given. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/sites/[id]/owner-agents">) {
  const sameOrigin = sameOriginBrowserRequestError(request);
  if (sameOrigin) return jsonError(403, sameOrigin);

  const found = await ownedSite((await ctx.params).id);
  if ("error" in found) return found.error;

  const agentId = new URL(request.url).searchParams.get("agentId");
  if (!agentId || !isUuid(agentId)) return jsonError(400, "Which agent?");
  await db.delete(ownerAgents).where(and(eq(ownerAgents.id, agentId), eq(ownerAgents.siteId, found.site.id)));
  return NextResponse.json({ removed: true });
}
