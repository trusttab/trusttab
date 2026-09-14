import "server-only";

import { lt, sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db";
import { manifestHits } from "@/db/schema";

import { anonymizeIp, clientIp } from "./ip";

/** Traffic-log rows older than this are deleted. */
export const HIT_RETENTION_DAYS = 30;

/**
 * Records a request to one of a site's public endpoints for its traffic log.
 *
 * - Runs after the response is sent (`after`), so logging never slows down or
 *   breaks the public endpoint; failures are logged and swallowed.
 * - Stores a coarsened IP (IPv4 /24, IPv6 /48), never the full address.
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
      await db.insert(manifestHits).values({ siteId, endpoint, requesterIp, userAgent });
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
