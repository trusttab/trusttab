import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { issueCollectorToken } from "@/lib/agent-traffic/collector";
import { getApiUser, isUuid, jsonError } from "@/lib/api";
import { sameOriginBrowserRequestError } from "@/lib/same-origin";

/**
 * POST /api/sites/:id/agent-traffic — the owner turns site-wide agent traffic
 * collection on or off. Body: `{ "action": "enable" | "disable" }`.
 *
 * Enabling is opt-in and deliberate: it starts collecting data about all
 * traffic to the site, not just TrustTab lookups, so it happens only from the
 * dashboard (same-origin browser request) and returns the collector token
 * once. The token is never retrievable again; enabling again issues a new one
 * and retires the old.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/agent-traffic">) {
  const sameOrigin = sameOriginBrowserRequestError(request);
  if (sameOrigin) return jsonError(403, sameOrigin);

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

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;

  if (body?.action === "enable") {
    const { token, hash } = issueCollectorToken(site.id);
    await db.update(sites).set({ agentTrafficEnabledAt: new Date(), agentTrafficTokenHash: hash }).where(eq(sites.id, site.id));
    // The only time the token is returned; only its hash is stored.
    return NextResponse.json({ enabled: true, token });
  }

  if (body?.action === "disable") {
    await db.update(sites).set({ agentTrafficEnabledAt: null, agentTrafficTokenHash: null }).where(eq(sites.id, site.id));
    // Rows already collected are left to age out under the 30-day retention.
    return NextResponse.json({ enabled: false });
  }

  return jsonError(400, 'Expected { "action": "enable" | "disable" }.');
}
