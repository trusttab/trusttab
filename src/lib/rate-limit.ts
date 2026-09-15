import "server-only";

import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db";

import { clientIp } from "./ip";

/**
 * Fixed-window rate limiting stored in Postgres, so limits hold across
 * serverless instances (an in-memory counter would be per instance). One
 * upsert per request. Used for the public endpoints and, via
 * `authRateLimitStorage`, for Better Auth's sign-in/sign-up limits.
 *
 * Keys are HMAC-hashed before storage, so the table never contains raw client
 * IPs. This is an application-level floor; for real abuse, put a platform/WAF
 * rate limit in front as well.
 */

export const PUBLIC_LIMITS = {
  /** Manifest and registry lookups, per IP. */
  api: { limit: 120, windowSeconds: 60 },
  /** Badge images, per IP (pages embedding a badge may load it often). */
  badge: { limit: 300, windowSeconds: 60 },
  /** The public HTML verification page (badge link target), per IP. Humans click it; scrapers loop it. */
  page: { limit: 60, windowSeconds: 60 },
} as const;

export type Bucket = keyof typeof PUBLIC_LIMITS;

/**
 * Counts one request against `key` and reports whether it is within `limit`
 * for the current `windowSeconds` window. `key` may contain an IP; it is
 * hashed before it reaches the database.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const hashedKey = hashKey(key);
  const [row] = await db.execute<{ count: number; reset_in: number }>(sql`
    INSERT INTO rate_limit_buckets (key, window_start, count, expires_at)
    VALUES (${hashedKey}, now(), 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets.expires_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
      window_start = CASE WHEN rate_limit_buckets.expires_at <= now() THEN now() ELSE rate_limit_buckets.window_start END,
      expires_at = CASE WHEN rate_limit_buckets.expires_at <= now() THEN EXCLUDED.expires_at ELSE rate_limit_buckets.expires_at END
    RETURNING count, ceil(extract(epoch from (expires_at - now())))::int AS reset_in
  `);

  // Occasionally clear out expired buckets; no cron needed. Each row carries
  // its own expiry, so a day-long window is never pruned early.
  if (Math.random() < 0.01) {
    after(() => db.execute(sql`DELETE FROM rate_limit_buckets WHERE expires_at < now()`));
  }

  return { allowed: row.count <= limit, retryAfter: Math.max(1, row.reset_in) };
}

/**
 * For public route handlers: returns a 429 Response if the request is over
 * its bucket's limit, or null if it may proceed. Requests without an
 * identifiable client IP are not limited (see clientIp): sharing one bucket
 * among them would let one client block all.
 */
export async function enforceRateLimit(
  request: Request,
  bucket: Bucket,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const ip = clientIp(request);
  if (!ip) return null;

  const { limit, windowSeconds } = PUBLIC_LIMITS[bucket];
  const { allowed, retryAfter } = await consumeRateLimit(`${bucket}:${ip}`, limit, windowSeconds);
  if (allowed) return null;

  return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
    status: 429,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(retryAfter),
      // Never cacheable: a CDN caching one client's 429 would serve it to everyone.
      "cache-control": "no-store",
    },
  });
}

export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

/**
 * For endpoints where every request costs money (e.g. a model API call):
 * applies each rule in order, per client IP, and returns a Response to send
 * if any is exceeded, or null to proceed. Unlike `enforceRateLimit`, this
 * fails closed: a request with no identifiable client IP is rejected, because
 * letting it through would let it bypass the limit on a paid call.
 *
 * Rules with `perClient: false` use one shared bucket for everyone, a global
 * budget. List them after the per-client rules, so one client's rejected
 * requests don't use up the shared budget.
 */
export async function enforcePaidRateLimits(
  request: Request,
  rules: (RateLimitRule & { perClient?: boolean; message: string; status?: number })[],
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const ip = clientIp(request);
  const reject = (status: number, error: string, retryAfter?: number) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: {
        ...headers,
        "content-type": "application/json; charset=utf-8",
        ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
        "cache-control": "no-store",
      },
    });
  if (!ip) return reject(400, "Couldn't identify the client for rate limiting.");

  for (const rule of rules) {
    const key = rule.perClient === false ? `${rule.name}:global` : `${rule.name}:${ip}`;
    const { allowed, retryAfter } = await consumeRateLimit(key, rule.limit, rule.windowSeconds);
    if (!allowed) return reject(rule.status ?? 429, rule.message, retryAfter);
  }
  return null;
}

/**
 * Better Auth rate-limit storage backed by the same table. Better Auth builds
 * keys as `<ip>|<path>` and picks the rule (e.g. 3 sign-in attempts per 10s);
 * we only persist the count, under a hashed key.
 */
export const authRateLimitStorage = {
  async consume(key: string, rule: { window: number; max: number }) {
    const { allowed, retryAfter } = await consumeRateLimit(`auth:${key}`, rule.max, rule.window);
    return { allowed, retryAfter: allowed ? null : retryAfter };
  },
};

function hashKey(key: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");
  return createHmac("sha256", secret).update(`rate-limit:${key}`).digest("base64url").slice(0, 32);
}
