import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { manifestHits } from "@/db/schema";

import type { AgentTier } from "./classify";

/** Time ranges offered by the panel. */
export const AGENT_TRAFFIC_RANGES = [7, 30] as const;
export type AgentTrafficRange = (typeof AGENT_TRAFFIC_RANGES)[number];

export function parseRange(value: unknown): AgentTrafficRange {
  const days = Number(value);
  return (AGENT_TRAFFIC_RANGES as readonly number[]).includes(days) ? (days as AgentTrafficRange) : 7;
}

export type AgentGroup = { identity: string; signal: string | null; requests: number; lastSeen: Date };

export type AgentTrafficSummary = {
  days: AgentTrafficRange;
  /** Requests per tier, including rows recorded before classification existed (counted as unclassified). */
  totals: Record<AgentTier, number>;
  total: number;
  verified: AgentGroup[];
  likelyAutomated: AgentGroup[];
};

/**
 * Agent-traffic summary for one site's requests to TrustTab's public
 * endpoints (its manifest and registry lookups). This is the no-install
 * source: it works for every site regardless of how it is hosted, because the
 * requests arrive at TrustTab rather than at the site.
 */
export async function getAgentTraffic(siteId: string, days: AgentTrafficRange): Promise<AgentTrafficSummary> {
  const since = sql`now() - make_interval(days => ${days})`;
  const inRange = and(eq(manifestHits.siteId, siteId), gte(manifestHits.createdAt, since));

  const [tierRows, groupRows] = await Promise.all([
    db
      .select({ tier: manifestHits.agentTier, count: sql<number>`count(*)::int` })
      .from(manifestHits)
      .where(inRange)
      .groupBy(manifestHits.agentTier),
    db
      .select({
        tier: manifestHits.agentTier,
        identity: manifestHits.agentIdentity,
        signal: manifestHits.agentSignal,
        requests: sql<number>`count(*)::int`,
        lastSeen: sql<Date>`max(${manifestHits.createdAt})`,
      })
      .from(manifestHits)
      .where(inRange)
      .groupBy(manifestHits.agentTier, manifestHits.agentIdentity, manifestHits.agentSignal)
      .orderBy(sql`count(*) desc`),
  ]);

  const totals: Record<AgentTier, number> = { verified: 0, likely_automated: 0, trusttab: 0, unclassified: 0 };
  for (const row of tierRows) {
    // Rows from before classification existed have no tier; they are unclassified.
    totals[(row.tier ?? "unclassified") as AgentTier] += row.count;
  }

  const groupsFor = (tier: AgentTier): AgentGroup[] =>
    groupRows
      .filter((row) => row.tier === tier)
      .map((row) => ({
        identity: row.identity ?? "Unnamed",
        signal: row.signal,
        requests: row.requests,
        lastSeen: new Date(row.lastSeen),
      }));

  return {
    days,
    totals,
    total: Object.values(totals).reduce((sum, count) => sum + count, 0),
    verified: groupsFor("verified"),
    likelyAutomated: groupsFor("likely_automated"),
  };
}
