import "server-only";

import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db";

import { clientIp } from "./ip";

/**
 * Fixed-window rate limiting for the public endpoints, stored in Postgres so
 * the limit holds across serverless instances (an in-memory counter would be
 * per instance). One upsert per request.
 *
 * Buckets are keyed by an HMAC of the client IP, so raw IPs are never stored
 * here either. This is an application-level floor; for real abuse, put a
 * platform/WAF rate limit in front as well.
 */

export const PUBLIC_LIMITS = {
  /** Manifest and registry lookups, per IP. */
  api: { limit: 120, windowSeconds: 60 },
  /** Badge images, per IP (pages embedding a badge may load it often). */
  badge: { limit: 300, windowSeconds: 60 },
} as const;

export type Bucket = keyof typeof PUBLIC_LIMITS;

/**
 * Returns a 429 Response if the request is over its limit, or null if it may
 * proceed. Requests without an identifiable client IP are not limited (see
 * clientIp): sharing one bucket among them would let one client block all.
 */
export async function enforceRateLimit(
  request: Request,
  bucket: Bucket,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  const ip = clientIp(request);
  if (!ip) return null;

  const { limit, windowSeconds } = PUBLIC_LIMITS[bucket];
  const key = `${bucket}:${hashIp(ip)}`;

  const [row] = await db.execute<{ count: number; reset_in: number }>(sql`
    INSERT INTO rate_limit_buckets (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limit_buckets.window_start <= now() - make_interval(secs => ${windowSeconds}) THEN 1
        ELSE rate_limit_buckets.count + 1
      END,
      window_start = CASE
        WHEN rate_limit_buckets.window_start <= now() - make_interval(secs => ${windowSeconds}) THEN now()
        ELSE rate_limit_buckets.window_start
      END
    RETURNING count,
      ceil(extract(epoch from (window_start + make_interval(secs => ${windowSeconds}) - now())))::int AS reset_in
  `);

  // Occasionally clear out stale buckets; no cron needed.
  if (Math.random() < 0.01) {
    after(() => db.execute(sql`DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '1 hour'`));
  }

  if (row.count <= limit) return null;
  return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
    status: 429,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(Math.max(1, row.reset_in)),
      // Never cacheable: a CDN caching one client's 429 would serve it to everyone.
      "cache-control": "no-store",
    },
  });
}

function hashIp(ip: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");
  return createHmac("sha256", secret).update(`rate-limit:${ip}`).digest("base64url").slice(0, 32);
}
