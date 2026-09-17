import { MAX_EVENTS_PER_REQUEST, recordSiteHits, siteForCollectorToken, type CollectorEvent } from "@/lib/agent-traffic/collector";
import { consumeRateLimit } from "@/lib/rate-limit";

export const maxDuration = 30;

/** Ingest bodies are small: a token and at most MAX_EVENTS_PER_REQUEST events. */
const MAX_BODY_BYTES = 64_000;
/** Per site, not per IP: the collector runs on the site's own infrastructure. */
const SITE_LIMIT = { limit: 120, windowSeconds: 60 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/**
 * POST /api/agent-traffic/ingest — where a site's own collector reports
 * requests, so the owner can see agent traffic to their pages and not just to
 * TrustTab's endpoints. Authenticated by the site's collector token, which
 * exists only while the owner has collection turned on.
 *
 * Privacy: visitor IPs arrive here so they can be matched against published
 * agent ranges, are used in memory only, and are stored coarsened (IPv4 /24,
 * IPv6 /48). Rows are deleted after 30 days. Nothing else about the visitor
 * is accepted: no cookies, no query strings, no body content.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return json(413, { error: "Body too large." });
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "Body too large." });

  let body: { token?: unknown; events?: unknown };
  try {
    body = JSON.parse(raw) as { token?: unknown; events?: unknown };
  } catch {
    return json(400, { error: 'Expected {"token": "...", "events": [...]}.' });
  }

  const site = await siteForCollectorToken(body.token);
  // One answer for a bad token and for collection being off, so the endpoint
  // can't be used to probe which site ids exist.
  if (!site) return json(401, { error: "Unknown or disabled collector token." });

  const { allowed, retryAfter } = await consumeRateLimit(`agent-ingest:${site.id}`, SITE_LIMIT.limit, SITE_LIMIT.windowSeconds);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Too many reports. Batch events or report less often." }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(retryAfter), "cache-control": "no-store" },
    });
  }

  const events = Array.isArray(body.events) ? (body.events as CollectorEvent[]) : null;
  if (!events) return json(400, { error: "Expected an events array." });

  const stored = await recordSiteHits(site.id, events.slice(0, MAX_EVENTS_PER_REQUEST));
  return json(202, { accepted: stored });
}
