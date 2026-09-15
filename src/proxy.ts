import { NextResponse, type NextRequest } from "next/server";

import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Runs before requests reach the app (Next.js 16 "proxy", formerly
 * middleware; Node.js runtime). Two jobs:
 *
 * 1. Reject request paths that aren't valid percent-encoding (e.g.
 *    `/api/manifest/%E0%A4%A`) with a 400. Otherwise Next.js fails while
 *    decoding route parameters, before any route handler runs, and responds
 *    with a 500.
 * 2. Rate-limit the public verification page. Pages can't return a 429
 *    themselves, and every render of that page does registry lookups, so it
 *    gets the same Postgres-backed per-IP limit as the public API routes
 *    (which enforce theirs inside each route handler).
 */
export async function proxy(request: NextRequest) {
  if (!isDecodablePath(request.url)) {
    return new NextResponse("Bad request: the address contains invalid percent-encoding.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (!request.nextUrl.pathname.startsWith("/verify/")) return NextResponse.next();

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

/** True if every percent-escape in the URL's path decodes to valid UTF-8. */
function isDecodablePath(rawUrl: string): boolean {
  // Take the path from the raw URL string: URL parsing keeps escapes as-is.
  const path = rawUrl.replace(/^[a-z]+:\/\/[^/]*/i, "").split(/[?#]/, 1)[0];
  try {
    decodeURIComponent(path);
    return true;
  } catch {
    return false;
  }
}

export const config = {
  // Everything except Next's static assets and image optimizer.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
