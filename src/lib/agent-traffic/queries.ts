import "server-only";

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { manifestHits, siteAgentHits } from "@/db/schema";

import type { AgentTier } from "./classify";
import type { TimelineRequest } from "./timeline";

/** Time windows offered by the panels. */
export const AGENT_TRAFFIC_WINDOWS = ["24h", "48h", "7d", "30d"] as const;
export type AgentTrafficRange = (typeof AGENT_TRAFFIC_WINDOWS)[number];

const WINDOW_HOURS: Record<AgentTrafficRange, number> = { "24h": 24, "48h": 48, "7d": 24 * 7, "30d": 24 * 30 };

export function parseRange(value: unknown): AgentTrafficRange {
  return (AGENT_TRAFFIC_WINDOWS as readonly unknown[]).includes(value) ? (value as AgentTrafficRange) : "7d";
}

export function windowLabel(range: AgentTrafficRange): string {
  return { "24h": "last 24 hours", "48h": "last 48 hours", "7d": "last 7 days", "30d": "last 30 days" }[range];
}

const since = (range: AgentTrafficRange) => sql`now() - make_interval(hours => ${WINDOW_HOURS[range]})`;

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
  const totals: Record<AgentTier, number> = { verified: 0, likely_automated: 0, owner_identified: 0, trusttab: 0, unclassified: 0 };
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
    .where(and(eq(manifestHits.siteId, siteId), gte(manifestHits.createdAt, since(days))))
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
    .where(and(eq(siteAgentHits.siteId, siteId), gte(siteAgentHits.createdAt, since(days))))
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
    gte(siteAgentHits.createdAt, since(days)),
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

export type AgentVolume = {
  identity: string;
  tier: AgentTier;
  requests: number;
  distinctPaths: number;
  lastSeen: Date;
};

/**
 * Agents ranked by request volume on the site's own pages, the entry point to
 * the session timeline. Only identified traffic appears: unclassified requests
 * have no agent to rank, and TrustTab's own checks aren't visitors.
 */
export async function getAgentVolume(siteId: string, days: AgentTrafficRange, limit = 20): Promise<AgentVolume[]> {
  const rows = await db
    .select({
      identity: siteAgentHits.agentIdentity,
      tier: siteAgentHits.agentTier,
      requests: sql<number>`count(*)::int`,
      distinctPaths: sql<number>`count(distinct ${siteAgentHits.path})::int`,
      lastSeen: sql<Date>`max(${siteAgentHits.createdAt})`,
    })
    .from(siteAgentHits)
    .where(
      and(
        eq(siteAgentHits.siteId, siteId),
        gte(siteAgentHits.createdAt, since(days)),
        inArray(siteAgentHits.agentTier, ["verified", "likely_automated", "owner_identified"]),
      ),
    )
    .groupBy(siteAgentHits.agentIdentity, siteAgentHits.agentTier)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  return rows
    .filter((row) => row.identity)
    .map((row) => ({
      identity: row.identity!,
      tier: (row.tier ?? "unclassified") as AgentTier,
      requests: row.requests,
      distinctPaths: row.distinctPaths,
      lastSeen: new Date(row.lastSeen),
    }));
}

/** One agent's requests in time order, for the timeline view. Capped, newest last. */
export async function getAgentTimeline(siteId: string, identity: string, days: AgentTrafficRange, limit = 500): Promise<TimelineRequest[]> {
  const rows = await db
    .select({
      at: siteAgentHits.createdAt,
      method: siteAgentHits.method,
      path: siteAgentHits.path,
      tier: siteAgentHits.agentTier,
      declaredIntent: siteAgentHits.declaredIntent,
      scopeMismatch: siteAgentHits.scopeMismatch,
    })
    .from(siteAgentHits)
    .where(and(eq(siteAgentHits.siteId, siteId), eq(siteAgentHits.agentIdentity, identity), gte(siteAgentHits.createdAt, since(days))))
    .orderBy(desc(siteAgentHits.createdAt))
    .limit(limit);

  return rows
    .map((row) => ({ ...row, at: new Date(row.at), tier: (row.tier ?? "unclassified") as AgentTier }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

export type EnforcementObservations = {
  /** Requests the edge said something about at all. */
  observed: number;
  /** Requests the edge would have refused, had blocking existed. */
  edgeWouldBlock: number;
  /** Requests TrustTab itself found outside a declared scope, checking the verified signature. */
  serverMismatch: number;
  /** Where the two disagreed, which is the finding this milestone exists to produce. */
  disagreements: { path: string | null; at: Date; edge: string | null; server: string | null }[];
};

/**
 * Evidence from observe-only enforcement: what a site's own edge concluded,
 * next to what TrustTab concluded about the same requests.
 *
 * The edge does not verify the RFC 9421 signature, so it reads a declaration
 * as presented; TrustTab checks it against the signature. Agreement is the
 * expected case. A disagreement means an edge acting alone would have got that
 * request wrong — which is exactly what has to be understood before an edge is
 * trusted to refuse anything.
 */
export async function getEnforcementObservations(siteId: string, range: AgentTrafficRange): Promise<EnforcementObservations> {
  const rows = await db
    .select({
      path: siteAgentHits.path,
      at: siteAgentHits.createdAt,
      edge: siteAgentHits.edgeReason,
      edgeWouldBlock: siteAgentHits.edgeWouldBlock,
      server: siteAgentHits.scopeMismatch,
    })
    .from(siteAgentHits)
    .where(and(eq(siteAgentHits.siteId, siteId), gte(siteAgentHits.createdAt, since(range))))
    .orderBy(desc(siteAgentHits.createdAt))
    .limit(2000);

  const observed = rows.filter((row) => row.edgeWouldBlock !== null);
  return {
    observed: observed.length,
    edgeWouldBlock: observed.filter((row) => row.edgeWouldBlock === true).length,
    serverMismatch: observed.filter((row) => row.server !== null).length,
    disagreements: observed
      .filter((row) => (row.edge ?? null) !== (row.server ?? null))
      .slice(0, 20)
      .map(({ path, at, edge, server }) => ({ path, at, edge, server })),
  };
}
