import { PURPOSES, type Purpose } from "@/lib/manifest/types";

/**
 * The enforcement rule feed: what a site's own edge needs to decide, locally,
 * whether a request falls outside what an agent declared.
 *
 * **Blocking is not built, and nothing here can block.** This is the
 * observe-only milestone: the edge evaluates and reports what it *would* have
 * concluded, TrustTab independently recomputes the same question server-side
 * from the request it was sent, and the dashboard shows both. Blocking is a
 * separate milestone that only begins once that evidence has been reviewed
 * against real production traffic.
 *
 * ## Why a feed rather than asking TrustTab per request
 *
 * Measured before choosing (2026-09-20): a round trip to this deployment costs
 * ~190–280ms warm and **3.2 seconds cold**, with functions in a single region
 * (`iad1`). An inline check with a timeout short enough not to hurt a customer's
 * site would time out on exactly the cold paths where a new agent first appears
 * — enforcement that is absent when it matters. A feed puts no TrustTab call in
 * the request path at all.
 *
 * ## How it fails open, structurally
 *
 * A feed that simply caches the last known rules does **not** fail open: it
 * fails *static*. If TrustTab went dark, enforcement would continue unsupervised,
 * and a wrong rule would be stuck with no channel to correct it — worse than an
 * inline check, which self-corrects on the next request.
 *
 * So every feed carries `expires_at`, and the edge drops an expired feed
 * entirely rather than falling back to it. If TrustTab is slow, broken, or gone,
 * the feed goes stale within minutes and the edge stops evaluating anything.
 * That is the fail-open property, and it is a property of the format rather than
 * of how someone configured it.
 */

export const FEED_VERSION = "1.0";

/**
 * How long a feed stays usable.
 *
 * Short, because this is the window in which a mistake or an outage keeps
 * having effect: whatever is wrong stops mattering three minutes later. Not
 * shorter, because the edge refetches once per window and a very small TTL
 * turns a routine deploy or a brief blip into constant refetching for no gain.
 */
export const FEED_TTL_SECONDS = 180;

/** A site's published endpoints are the vocabulary a declaration is checked against. */
export const MAX_FEED_ENDPOINTS = 100;

export type FeedEndpoint = { path: string; purpose: Purpose };

export type UnsignedEnforcementFeed = {
  version: typeof FEED_VERSION;
  issuer: string;
  site: { domain: string; verification_id: string | null };
  /**
   * The only mode that exists. A feed can't ask an edge to block, because
   * nothing on either side implements blocking; when it does, this field is
   * how a customer opts in, per site, having seen the observations first.
   */
  mode: "observe";
  issued_at: string;
  expires_at: string;
  /**
   * The manifest purpose taxonomy, carried so the edge drops purposes it
   * doesn't recognise the same way the server does.
   *
   * Without this the two disagree: an agent declaring an unknown purpose is
   * treated by the server as having declared nothing, while an edge with no
   * vocabulary keeps the unknown value and concludes the request fell outside
   * it. The parity test caught that before any of it could block anything.
   */
  purposes: Purpose[];
  endpoints: FeedEndpoint[];
};

/**
 * The signature travels in the `X-TrustTab-Signature` response header, over the
 * exact bytes of the body, rather than as a field inside the document. The edge
 * then verifies what it received and never needs a canonical-JSON
 * implementation of its own.
 */
export const FEED_SIGNATURE_HEADER = "x-trusttab-signature";

export function buildEnforcementFeed(input: {
  issuer: string;
  domain: string;
  verificationId: string | null;
  endpoints: FeedEndpoint[];
  now?: Date;
}): UnsignedEnforcementFeed {
  const now = input.now ?? new Date();
  return {
    version: FEED_VERSION,
    issuer: input.issuer,
    site: { domain: input.domain, verification_id: input.verificationId },
    mode: "observe",
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + FEED_TTL_SECONDS * 1000).toISOString(),
    purposes: [...PURPOSES],
    // Sorted so an unchanged site produces a byte-identical document apart from
    // its timestamps, which makes "did the rules actually change" answerable.
    endpoints: input.endpoints
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path) || a.purpose.localeCompare(b.purpose))
      .slice(0, MAX_FEED_ENDPOINTS),
  };
}

/**
 * Whether a feed may still be used. Anything unparseable or undated counts as
 * expired: the safe reading of a feed you don't understand is to ignore it.
 */
export function isFeedExpired(feed: { expires_at?: unknown }, now: Date = new Date()): boolean {
  if (typeof feed?.expires_at !== "string") return true;
  const expires = Date.parse(feed.expires_at);
  return Number.isNaN(expires) || expires <= now.getTime();
}
