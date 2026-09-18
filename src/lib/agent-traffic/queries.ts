import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { manifestHits, siteAgentHits } from "@/db/schema";

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
  /** Which traffic this summarizes: TrustTab's endpoints, or the site's own pages. */
  source: "registry" | "site";
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
async function summarize(
  source: "registry" | "site",
  days: AgentTrafficRange,
  rows: { tier: string | null; identity: string | null; signal: string | null; requests: number; lastSeen: Date }[],
): Promise<AgentTrafficSummary> {
  const totals: Record<AgentTier, number> = { verified: 0, likely_automated: 0, trusttab: 0, unclassified: 0 };
  for (const row of rows) {
    // Rows from before classification existed have no tier; they are unclassified.
    totals[(row.tier ?? "unclassified") as AgentTier] += row.requests;
  }

  const groupsFor = (tier: AgentTier): AgentGroup[] =>
    rows
      .filter((row) => row.tier === tier)
      .map((row) => ({
        identity: row.identity ?? "Unnamed",
        signal: row.signal,
        requests: row.requests,
        lastSeen: new Date(row.lastSeen),
      }));

  return {
    days,
    source,
    totals,
    total: Object.values(totals).reduce((sum, count) => sum + count, 0),
    verified: groupsFor("verified"),
    likelyAutomated: groupsFor("likely_automated"),
  };
}

/**
 * Agent traffic to TrustTab's public endpoints for one site (its manifest and
 * registry lookups). This is the no-install source: it works for every site
 * regardless of hosting, because the requests arrive at TrustTab.
 */
export async function getAgentTraffic(siteId: string, days: AgentTrafficRange): Promise<AgentTrafficSummary> {
  const rows = await db
    .select({
      tier: manifestHits.agentTier,
      identity: manifestHits.agentIdentity,
      signal: manifestHits.agentSignal,
      requests: sql<number>`count(*)::int`,
      lastSeen: sql<Date>`max(${manifestHits.createdAt})`,
    })
    .from(manifestHits)
    .where(and(eq(manifestHits.siteId, siteId), gte(manifestHits.createdAt, sql`now() - make_interval(days => ${days})`)))
    .groupBy(manifestHits.agentTier, manifestHits.agentIdentity, manifestHits.agentSignal)
    .orderBy(sql`count(*) desc`);
  return summarize("registry", days, rows);
}

/**
 * Agent traffic to the site's own pages, as reported by an installed
 * collector. Only exists for sites whose owner turned collection on.
 */
export async function getSiteAgentTraffic(siteId: string, days: AgentTrafficRange): Promise<AgentTrafficSummary> {
  const rows = await db
    .select({
      tier: siteAgentHits.agentTier,
      identity: siteAgentHits.agentIdentity,
      signal: siteAgentHits.agentSignal,
      requests: sql<number>`count(*)::int`,
      lastSeen: sql<Date>`max(${siteAgentHits.createdAt})`,
    })
    .from(siteAgentHits)
    .where(and(eq(siteAgentHits.siteId, siteId), gte(siteAgentHits.createdAt, sql`now() - make_interval(days => ${days})`)))
    .groupBy(siteAgentHits.agentTier, siteAgentHits.agentIdentity, siteAgentHits.agentSignal)
    .orderBy(sql`count(*) desc`);
  return summarize("site", days, rows);
}

export type AgentActivity = {
  identity: string;
  requests: number;
  /** Declarations this agent signed, as they read in the dashboard. */
  declarations: string[];
  /** Requests that fell outside a declaration, with an example of each kind. */
  mismatches: { reason: "path-outside-scope" | "purpose-not-declared"; requests: number; examplePath: string | null; declared: string | null }[];
  paths: { path: string; requests: number }[];
  lastSeen: Date;
};

/**
 * Per-agent activity for a site's own pages: who, what they declared, what
 * they actually requested, and any requests outside a declaration. Verified
 * agents only, because a declaration is part of a signature and an identity
 * that isn't verified can't be held to one.
 *
 * Only meaningful where site-wide collection is on; requests to TrustTab's own
 * endpoints say little about how an agent behaves on the site itself.
 */
export async function getAgentActivity(siteId: string, days: AgentTrafficRange, limit = 10): Promise<AgentActivity[]> {
  const inRange = and(
    eq(siteAgentHits.siteId, siteId),
    eq(siteAgentHits.agentTier, "verified"),
    gte(siteAgentHits.createdAt, sql`now() - make_interval(days => ${days})`),
  );

  const rows = await db
    .select({
      identity: siteAgentHits.agentIdentity,
      declaredIntent: siteAgentHits.declaredIntent,
      scopeMismatch: siteAgentHits.scopeMismatch,
      path: siteAgentHits.path,
      requests: sql<number>`count(*)::int`,
      lastSeen: sql<Date>`max(${siteAgentHits.createdAt})`,
    })
    .from(siteAgentHits)
    .where(inRange)
    .groupBy(siteAgentHits.agentIdentity, siteAgentHits.declaredIntent, siteAgentHits.scopeMismatch, siteAgentHits.path)
    .orderBy(sql`count(*) desc`);

  const byIdentity = new Map<string, AgentActivity>();
  for (const row of rows) {
    const identity = row.identity ?? "Unnamed";
    const entry = byIdentity.get(identity) ?? { identity, requests: 0, declarations: [], mismatches: [], paths: [], lastSeen: new Date(row.lastSeen) };
    entry.requests += row.requests;
    if (row.declaredIntent && !entry.declarations.includes(row.declaredIntent)) entry.declarations.push(row.declaredIntent);
    if (new Date(row.lastSeen) > entry.lastSeen) entry.lastSeen = new Date(row.lastSeen);

    if (row.path) {
      const path = entry.paths.find((p) => p.path === row.path);
      if (path) path.requests += row.requests;
      else entry.paths.push({ path: row.path, requests: row.requests });
    }

    if (row.scopeMismatch) {
      const mismatch = entry.mismatches.find((m) => m.reason === row.scopeMismatch);
      if (mismatch) mismatch.requests += row.requests;
      else entry.mismatches.push({ reason: row.scopeMismatch, requests: row.requests, examplePath: row.path, declared: row.declaredIntent });
    }
    byIdentity.set(identity, entry);
  }

  for (const entry of byIdentity.values()) {
    entry.paths.sort((a, b) => b.requests - a.requests);
    entry.paths = entry.paths.slice(0, 5);
  }
  return [...byIdentity.values()].sort((a, b) => b.requests - a.requests).slice(0, limit);
}
