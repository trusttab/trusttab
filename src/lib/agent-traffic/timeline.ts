import type { AgentTier } from "./classify";

/**
 * Session timeline: one agent's requests in time order, for reviewing
 * scraping patterns.
 *
 * What distinguishes scraping from ordinary agent use is rate and breadth
 * close together in time, which a timeline shows directly. The numbers are
 * stated as numbers; the one heuristic flag has a documented threshold and
 * says it is a heuristic. Nothing here concludes "this is a scraper" — the
 * evidence is on screen and the owner draws the conclusion.
 */

export type TimelineRequest = {
  at: Date;
  method: string | null;
  path: string | null;
  tier: AgentTier;
  declaredIntent: string | null;
  scopeMismatch: "path-outside-scope" | "purpose-not-declared" | null;
};

export type TimelineStats = {
  requests: number;
  distinctPaths: number;
  /** Seconds between the first and last request in the window, or 0 for a single request. */
  spanSeconds: number;
  /** The most requests seen inside any 60-second window: the burst rate, not the average. */
  peakPerMinute: number;
  outsideScope: number;
};

/**
 * Requests inside any 60-second window, at its peak. An average over hours
 * would hide a burst, which is exactly the shape worth seeing.
 */
export function peakRequestsPerMinute(times: Date[]): number {
  if (times.length === 0) return 0;
  const sorted = times.map((t) => t.getTime()).sort((a, b) => a - b);
  let peak = 1;
  let start = 0;
  for (let end = 0; end < sorted.length; end++) {
    while (sorted[end] - sorted[start] >= 60_000) start++;
    peak = Math.max(peak, end - start + 1);
  }
  return peak;
}

export function summarizeTimeline(requests: TimelineRequest[]): TimelineStats {
  const times = requests.map((r) => r.at);
  const sorted = times.map((t) => t.getTime()).sort((a, b) => a - b);
  return {
    requests: requests.length,
    distinctPaths: new Set(requests.map((r) => r.path ?? "")).size,
    spanSeconds: sorted.length > 1 ? Math.round((sorted[sorted.length - 1] - sorted[0]) / 1000) : 0,
    peakPerMinute: peakRequestsPerMinute(times),
    outsideScope: requests.filter((r) => r.scopeMismatch !== null).length,
  };
}

/**
 * The documented threshold for the rate flag: 60 requests inside a single
 * 60-second window, i.e. one per second sustained for a minute.
 *
 * Why this number: it is far above human browsing, and above the pace
 * well-behaved crawlers use by default (robots.txt `Crawl-delay` conventions
 * are seconds *between* requests, not requests per second). Legitimate
 * traffic can still reach it — a page with many assets, a burst of prefetching
 * — which is why it is a flag on a timeline the owner reads, not a verdict.
 */
export const HIGH_RATE_PER_MINUTE = 60;

export function formatSpan(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minute${Math.round(seconds / 60) === 1 ? "" : "s"}`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hour${Math.round(seconds / 3600) === 1 ? "" : "s"}`;
  return `${Math.round(seconds / 86_400)} day${Math.round(seconds / 86_400) === 1 ? "" : "s"}`;
}

export type TimelineReadout = {
  /** The plain facts, e.g. "47 requests in 4 minutes, 312 distinct pages". */
  summary: string;
  /** The heuristic flag, when the rate threshold is passed. Null otherwise. */
  rateFlag: string | null;
  /** Why the flag appeared, so the number isn't mysterious. */
  rateDetail: string | null;
};

export function describeTimeline(stats: TimelineStats): TimelineReadout {
  const parts = [
    `${stats.requests} request${stats.requests === 1 ? "" : "s"}`,
    stats.spanSeconds > 0 ? `in ${formatSpan(stats.spanSeconds)}` : null,
    `${stats.distinctPaths} distinct page${stats.distinctPaths === 1 ? "" : "s"}`,
  ].filter(Boolean);

  const flagged = stats.peakPerMinute >= HIGH_RATE_PER_MINUTE;
  return {
    summary: `${parts[0]} ${parts.slice(1).join(", ")}`.trim(),
    rateFlag: flagged ? "Unusually high request rate (heuristic)" : null,
    rateDetail: flagged
      ? `Peaked at ${stats.peakPerMinute} requests in one minute, past the ${HIGH_RATE_PER_MINUTE}-per-minute threshold this flag uses. Ordinary traffic can reach that too — many assets on one page, or prefetching — so it points at the timeline below rather than concluding anything.`
      : null,
  };
}
