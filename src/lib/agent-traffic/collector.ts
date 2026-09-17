import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { siteAgentHits, sites } from "@/db/schema";
import { anonymizeIp } from "@/lib/ip";

import { classifyRequest } from "./classify";

/**
 * Site-wide agent traffic: the opt-in half of this feature, where a collector
 * the owner installs on their own site (see collectors/) reports requests to
 * TrustTab.
 *
 * The token is `<site id>.<secret>`; only a hash of the secret is stored, so a
 * database leak doesn't let anyone write traffic for a site. The token is
 * shown to the owner once, when they turn collection on.
 */

/** Rows older than this are deleted, matching the manifest traffic log. */
export const SITE_HIT_RETENTION_DAYS = 30;
/** Most events one ingest request may carry. */
export const MAX_EVENTS_PER_REQUEST = 20;

export type CollectorEvent = {
  /** The URL the visitor requested, used both for the path and to verify a signature's target. */
  url: string;
  method?: string;
  /** The visitor's IP, used in memory for range matching and never stored in full. */
  ip?: string | null;
  /** Only the headers classification needs: user-agent and the signature headers. */
  headers?: Record<string, string>;
};

export function issueCollectorToken(siteId: string): { token: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  return { token: `${siteId}.${secret}`, hash: hashSecret(secret) };
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Resolves a collector token to its site, or null. Constant-time on the secret. */
export async function siteForCollectorToken(token: unknown) {
  if (typeof token !== "string" || token.length > 200) return null;
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const siteId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(siteId) || secret.length < 16) return null;

  const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (!site?.agentTrafficTokenHash || !site.agentTrafficEnabledAt) return null;

  const expected = Buffer.from(site.agentTrafficTokenHash, "utf8");
  const actual = Buffer.from(hashSecret(secret), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return site;
}

/** Classifies and stores reported events. Returns how many were stored. */
export async function recordSiteHits(siteId: string, events: CollectorEvent[]): Promise<number> {
  const rows: (typeof siteAgentHits.$inferInsert)[] = [];

  for (const event of events.slice(0, MAX_EVENTS_PER_REQUEST)) {
    let url: URL;
    try {
      url = new URL(event.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;

    // Rebuild enough of the request for signature verification: the signature
    // covers the method, authority and path, so those must be what the visitor sent.
    const headers = new Headers();
    for (const [name, value] of Object.entries(event.headers ?? {})) {
      if (typeof value === "string" && value.length <= 4000) headers.set(name, value);
    }
    const request = new Request(url, { method: event.method === "POST" ? "POST" : "GET", headers });

    const ip = typeof event.ip === "string" ? event.ip : null;
    const agent = await classifyRequest(request, ip);
    rows.push({
      siteId,
      path: url.pathname.slice(0, 200),
      agentTier: agent.tier,
      agentIdentity: agent.identity,
      agentSignal: agent.signal,
      requesterIp: ip ? anonymizeIp(ip) : null,
      userAgent: headers.get("user-agent")?.slice(0, 500) ?? null,
    });
  }

  if (rows.length === 0) return 0;
  await db.insert(siteAgentHits).values(rows);
  if (Math.random() < 0.02) {
    await db
      .delete(siteAgentHits)
      .where(lt(siteAgentHits.createdAt, sql`now() - make_interval(days => ${SITE_HIT_RETENTION_DAYS})`));
  }
  return rows.length;
}
