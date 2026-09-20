import "server-only";

import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { agentKeys, siteAgentHits } from "@/db/schema";
import type { DirectoryKey } from "@/lib/agent-traffic/web-bot-auth";

/**
 * Durable copies of agent directory keys, so the enforcement feed can carry
 * them to a site's edge.
 *
 * The edge must never fetch a key directory itself — `Signature-Agent` names
 * the URL and is attacker-controlled, so an edge that fetched it would be a
 * request-forgery and amplification vector. TrustTab fetches through
 * safe-fetch, once, and distributes the result.
 *
 * Everything here is public key material. Nothing secret is stored.
 */

/**
 * How long a stored copy stays usable.
 *
 * Longer than the server's own six-hour directory cache, so a key that is still
 * in use doesn't vanish from feeds between refreshes — but finite, so a key an
 * operator has rotated away from ages out on its own rather than being served
 * indefinitely.
 */
export const AGENT_KEY_TTL_HOURS = 24;

/** Per feed, so one site's traffic can't produce an unbounded document. */
export const MAX_FEED_AGENTS = 20;
export const MAX_KEYS_PER_AGENT = 10;

/** Records keys just fetched from an operator's directory. Fire-and-forget. */
export async function rememberAgentKeys(identity: string, keys: DirectoryKey[]): Promise<void> {
  const rows = keys
    .filter((key) => typeof key.kid === "string" && typeof (key as { x?: unknown }).x === "string")
    .slice(0, MAX_KEYS_PER_AGENT)
    .map((key) => ({
      identity,
      kid: key.kid as string,
      jwk: { kty: "OKP", crv: "Ed25519", x: (key as unknown as { x: string }).x, kid: key.kid as string },
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + AGENT_KEY_TTL_HOURS * 3_600_000),
    }));
  if (rows.length === 0) return;

  await db
    .insert(agentKeys)
    .values(rows)
    .onConflictDoUpdate({
      target: [agentKeys.identity, agentKeys.kid],
      set: { jwk: sql`excluded.jwk`, fetchedAt: sql`excluded.fetched_at`, expiresAt: sql`excluded.expires_at` },
    });
}

export type FeedAgent = {
  identity: string;
  keys: { kid: string; x: string; expires_at: string }[];
};

/**
 * Keys to publish in one site's feed: the agents actually seen on that site,
 * so a feed carries what its edge will plausibly need and not the whole world.
 *
 * A key the edge doesn't have produces a "no key" verdict, which is reported as
 * exactly that — the edge had nothing to check against — rather than as a
 * judgment about the signature.
 */
export async function feedAgentsForSite(siteId: string): Promise<FeedAgent[]> {
  const seen = await db
    .selectDistinct({ identity: siteAgentHits.agentIdentity })
    .from(siteAgentHits)
    .where(and(eq(siteAgentHits.siteId, siteId), eq(siteAgentHits.agentTier, "verified")))
    .orderBy(desc(siteAgentHits.agentIdentity))
    .limit(MAX_FEED_AGENTS);

  const identities = seen.map((row) => row.identity).filter((identity): identity is string => Boolean(identity));
  if (identities.length === 0) return [];

  const rows = await db
    .select()
    .from(agentKeys)
    .where(and(inArray(agentKeys.identity, identities), gt(agentKeys.expiresAt, new Date())));

  const byIdentity = new Map<string, FeedAgent>();
  for (const row of rows) {
    const entry = byIdentity.get(row.identity) ?? { identity: row.identity, keys: [] };
    if (entry.keys.length < MAX_KEYS_PER_AGENT) {
      entry.keys.push({ kid: row.kid, x: row.jwk.x, expires_at: row.expiresAt.toISOString() });
    }
    byIdentity.set(row.identity, entry);
  }
  // Sorted so an unchanged set of keys produces an unchanged document.
  return [...byIdentity.values()]
    .map((agent) => ({ ...agent, keys: agent.keys.sort((a, b) => a.kid.localeCompare(b.kid)) }))
    .sort((a, b) => a.identity.localeCompare(b.identity));
}
