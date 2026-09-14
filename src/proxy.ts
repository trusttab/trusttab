import { NextResponse, type NextRequest } from "next/server";

import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Runs before matching requests reach the app (Next.js 16 "proxy", formerly
 * middleware; Node.js runtime).
 *
 * Its only job today is rate-limiting the public verification page. Pages
 * can't return a 429 status themselves, and every render of that page does
 * registry lookups, so it gets the same Postgres-backed per-IP limit as the
 * public API routes (which enforce theirs inside each route handler).
 */
export async function proxy(request: NextRequest) {
  const limited = await enforceRateLimit(request, "page");
  if (!limited) return NextResponse.next();

  // A readable page rather than the API's JSON body, since humans land here.
  return new NextResponse(
    "<!doctype html><title>Too many requests — TrustTab</title>" +
      "<p>Too many requests. Please wait a minute and try again.</p>",
    {
      status: 429,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "retry-after": limited.headers.get("retry-after") ?? "60",
        "cache-control": "no-store",
      },
    },
  );
}

export const config = {
  matcher: "/verify/:verificationId",
};
