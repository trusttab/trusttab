import { siteForCollectorToken } from "@/lib/agent-traffic/collector";
import { FEED_SIGNATURE_HEADER, FEED_TTL_SECONDS, buildEnforcementFeed, type FeedEndpoint } from "@/lib/enforcement/feed";
import { canonicalize } from "@/lib/manifest/canonical-json";
import { getIssuer } from "@/lib/manifest/build";
import { getLatestManifest } from "@/lib/manifest/queries";
import { signDetachedOverString } from "@/lib/manifest/signing";
import { consumeRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/enforcement/feed — the signed, expiring rule feed a site's own edge
 * fetches so it can evaluate requests locally, with no call to TrustTab in the
 * request path.
 *
 * **Observe-only.** The feed's mode is `observe` and nothing downstream
 * implements blocking. This milestone exists to produce evidence from real
 * traffic about what enforcement *would* have done, which the owner reviews
 * before blocking is written at all.
 *
 * Authenticated by the same collector token as ingest, so a feed is only
 * available to a site that has turned collection on, and the answer for a bad
 * token is identical to the answer for a disabled one.
 *
 * The body carries a detached JWS from the issuer key, verifiable against the
 * public JWKS: a customer's edge should not act on rules it cannot attribute,
 * and a cache or a proxy must not be able to alter them unnoticed.
 */

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

/** Generous: an edge fetches once per feed lifetime, and a few instances may do so. */
const SITE_LIMIT = { limit: 120, windowSeconds: 60 };

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const site = await siteForCollectorToken(token);
  if (!site) return json(401, { error: "Unknown or disabled collector token." });

  const { allowed, retryAfter } = await consumeRateLimit(`enforcement-feed:${site.id}`, SITE_LIMIT.limit, SITE_LIMIT.windowSeconds);
  if (!allowed) return json(429, { error: "Too many feed requests." }, { "retry-after": String(retryAfter) });

  const issuer = getIssuer();
  const latest = await getLatestManifest(site.id);
  // The vocabulary a declaration is checked against is the site's own published
  // endpoints. A site with no published manifest has nothing to compare, and
  // gets a feed with no endpoints rather than no feed: the edge still learns
  // that TrustTab is reachable and that its mode is observe.
  const endpoints: FeedEndpoint[] = (latest?.payloadJson.endpoints ?? []).map((endpoint) => ({
    path: endpoint.path,
    purpose: endpoint.purpose,
  }));

  const unsigned = buildEnforcementFeed({
    issuer: issuer.url,
    domain: site.domain,
    verificationId: site.verificationId,
    endpoints,
  });
  // The body is the canonical form and the signature covers exactly these
  // bytes, so the edge verifies what it received rather than re-deriving it.
  const body = canonicalize(unsigned);
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      [FEED_SIGNATURE_HEADER]: signDetachedOverString(body),
      // Matches the document's own lifetime, so a shared cache can never serve
      // a feed the edge would have discarded.
      "cache-control": `private, max-age=${FEED_TTL_SECONDS}`,
    },
  });
}
