import "server-only";

import { after } from "next/server";

import { db } from "@/db";
import { manifestHits } from "@/db/schema";

/**
 * Records a request to one of a site's public endpoints for its traffic log.
 *
 * Runs after the response is sent (`after`), so logging never slows down or
 * breaks the public endpoint; failures are logged and swallowed.
 *
 * The client IP comes from `x-forwarded-for`, which is trustworthy only
 * behind a proxy that sets it (as Vercel does). Self-hosters without such a
 * proxy will record whatever the client claims.
 */
export function recordHit(request: Request, siteId: string, endpoint: "manifest" | "verify") {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const requesterIp = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;

  after(async () => {
    try {
      await db.insert(manifestHits).values({ siteId, endpoint, requesterIp, userAgent });
    } catch (err) {
      console.error("Failed to record manifest hit", err);
    }
  });
}
