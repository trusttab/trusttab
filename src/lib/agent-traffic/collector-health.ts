/**
 * Whether a site's collector is actually reaching TrustTab.
 *
 * This exists because of a real failure: leasetab.com had collection switched
 * on, a valid-looking token in the dashboard, and a Worker deployed and
 * running — and recorded nothing at all for weeks. Nothing surfaced it. The
 * collector swallows its own errors on purpose (it must never disturb the
 * customer's site), the ingest endpoint answers 401 identically for a bad
 * token, a disabled site and an unknown one so it can't be used to probe, and
 * the dashboard cheerfully said collection was on. It took a query against the
 * production database to find out.
 *
 * So the signal reported here is **authenticated contact**, not rows. Those are
 * different questions, and separating them is the whole point:
 *
 *   - contact, no rows  → the token works; there is simply nothing to report yet
 *   - no contact at all → the token, the deployment or the routing is wrong
 *
 * Rows alone can't tell those apart, which is exactly how this hid.
 */

/** Past this, a collector that was working looks like it has stopped. */
export const COLLECTOR_SILENT_AFTER_HOURS = 24;

export type CollectorHealth = {
  state: "off" | "never" | "silent" | "quiet" | "reporting";
  title: string;
  detail: string;
  /** True when the owner needs to do something about it. */
  needsAttention: boolean;
};

export type CollectorHealthInput = {
  collectionEnabled: boolean;
  /** Last time an authenticated request arrived from this site's collector. */
  lastSeenAt: Date | null;
  /** Requests recorded in the window being displayed. */
  hitsInWindow: number;
  now?: Date;
};

function ago(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
}

export function describeCollectorHealth(input: CollectorHealthInput): CollectorHealth {
  const now = input.now ?? new Date();

  if (!input.collectionEnabled) {
    return {
      state: "off",
      title: "Collection is off",
      detail: "Nothing on your own pages is being reported to TrustTab.",
      needsAttention: false,
    };
  }

  if (!input.lastSeenAt) {
    return {
      state: "never",
      title: "Your collector has never reached TrustTab",
      detail:
        "Collection is on here, but no request from your collector has ever arrived. That usually means the token it holds doesn't match this site's — copy a fresh one below and set it on the collector again — or that the collector isn't deployed, or isn't on the route your traffic takes.",
      needsAttention: true,
    };
  }

  const hours = (now.getTime() - input.lastSeenAt.getTime()) / 3_600_000;
  if (hours >= COLLECTOR_SILENT_AFTER_HOURS) {
    return {
      state: "silent",
      title: `Your collector last reached TrustTab ${ago(input.lastSeenAt, now)}`,
      detail:
        "It was working before, so the token is right. Either the site has had no traffic since, or the collector has stopped running or been taken off the route.",
      needsAttention: true,
    };
  }

  if (input.hitsInWindow === 0) {
    return {
      state: "quiet",
      title: `Your collector is connected — last reached TrustTab ${ago(input.lastSeenAt, now)}`,
      detail:
        "It is authenticating correctly, and has recorded no requests in this window. That is an ordinary result for a quiet site or a short window, and it means something different from never having connected at all.",
      needsAttention: false,
    };
  }

  return {
    state: "reporting",
    title: `Your collector is reporting — last reached TrustTab ${ago(input.lastSeenAt, now)}`,
    detail: "Requests to your own pages are arriving and being classified.",
    needsAttention: false,
  };
}
