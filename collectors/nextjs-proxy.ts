/**
 * TrustTab agent-traffic collector for Next.js (proxy.ts, formerly
 * middleware.ts) and any Node server that can run code per request.
 *
 * It reports to TrustTab without awaiting the call, so it never delays a
 * response, and a failure to report is ignored rather than breaking a page.
 *
 * What it sends per request: the URL, the method, the visitor's IP, and the
 * user agent plus the Web Bot Auth signature headers. TrustTab uses the IP in
 * memory to match published agent ranges and stores only a coarsened form
 * (IPv4 /24, IPv6 /48). No cookies, query strings or page content are sent.
 *
 * Setup:
 *   1. Dashboard → your site → Agent traffic → turn on collection, copy the token.
 *   2. Set TRUSTTAB_COLLECTOR_TOKEN in your environment.
 *   3. Copy this file into your project and call reportAgentTraffic(request)
 *      from your proxy/middleware, as below.
 *
 *   export async function proxy(request: NextRequest) {
 *     reportAgentTraffic(request);        // not awaited
 *     return NextResponse.next();
 *   }
 */

const TRUSTTAB_URL = process.env.TRUSTTAB_URL ?? "https://trusttab-mu.vercel.app";
/** Only these headers are forwarded. */
const FORWARDED = ["user-agent", "signature", "signature-input", "signature-agent"];

export function reportAgentTraffic(request: Request): void {
  const token = process.env.TRUSTTAB_COLLECTOR_TOKEN;
  if (!token) return;

  const headers: Record<string, string> = {};
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  // The client IP as your platform reports it. On Vercel, Netlify and most
  // proxies this is x-forwarded-for; adjust if yours differs.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  void fetch(`${TRUSTTAB_URL}/api/agent-traffic/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, events: [{ url: request.url, method: request.method, ip, headers }] }),
    // Never let reporting hold up or fail the page.
    signal: AbortSignal.timeout(3_000),
  }).catch(() => {});
}
