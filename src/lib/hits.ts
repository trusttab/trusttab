import "server-only";

import { lt, sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db";
import { manifestHits } from "@/db/schema";

import { classifyRequest } from "./agent-traffic/classify";
import { ownerAgentsFor } from "./agent-traffic/collector";
import { formatDeclaration } from "./agent-traffic/intent";
import { describeOwnerAgent, matchOwnerAgent, OWNER_AGENT_HEADER } from "./agent-traffic/owner-agents";
import { anonymizeIp, clientIp } from "./ip";

/** Traffic-log rows older than this are deleted. */
export const HIT_RETENTION_DAYS = 30;

/**
 * Records a request to one of a site's public endpoints for its traffic log.
 *
 * - Runs after the response is sent (`after`), so logging never slows down or
 *   breaks the public endpoint; failures are logged and swallowed.
 * - Stores a coarsened IP (IPv4 /24, IPv6 /48), never the full address. The
 *   full IP is used only in memory, to classify the request against the
 *   operator ranges, and is never written anywhere.
 * - Classifies the request as agent traffic (see agent-traffic/classify.ts).
 *   Tier 1 may fetch the agent's key directory, which is why this runs after
 *   the response rather than in the request path.
 * - Rows expire after HIT_RETENTION_DAYS. Pruning piggybacks on writes (about
 *   1 in 50), so no scheduler is required.
 * - Callers apply the rate limit first, so a flood can't fill this table.
 */
export function recordHit(request: Request, siteId: string, endpoint: "manifest" | "verify") {
  const ip = clientIp(request);
  const requesterIp = ip ? anonymizeIp(ip) : null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  after(async () => {
    try {
      let agent = await classifyRequest(request, ip);
      if (agent.tier !== "verified" && agent.tier !== "trusttab") {
        const owned = matchOwnerAgent(
          { userAgent, ip, headerValue: request.headers.get(OWNER_AGENT_HEADER) },
          await ownerAgentsFor(siteId),
        );
        if (owned) agent = { ...agent, tier: "owner_identified", ...describeOwnerAgent(owned) };
      }
      await db.insert(manifestHits).values({
        siteId,
        endpoint,
        requesterIp,
        userAgent,
        agentTier: agent.tier,
        agentIdentity: agent.identity,
        agentSignal: agent.signal,
        declaredIntent: agent.declaration ? formatDeclaration(agent.declaration).slice(0, 400) : null,
      });
      if (Math.random() < 0.02) {
        await db
          .delete(manifestHits)
          .where(lt(manifestHits.createdAt, sql`now() - make_interval(days => ${HIT_RETENTION_DAYS})`));
      }
    } catch (err) {
      console.error("Failed to record manifest hit", err);
    }
  });
}
