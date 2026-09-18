import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeTimeline,
  formatSpan,
  HIGH_RATE_PER_MINUTE,
  peakRequestsPerMinute,
  summarizeTimeline,
  type TimelineRequest,
} from "./timeline";

const at = (secondsFromStart: number): Date => new Date(Date.UTC(2026, 8, 18, 12, 0, 0) + secondsFromStart * 1000);

const request = (seconds: number, path: string, mismatch: TimelineRequest["scopeMismatch"] = null): TimelineRequest => ({
  at: at(seconds),
  method: "GET",
  path,
  tier: "verified",
  declaredIntent: mismatch ? "booking under /schedule-tour" : null,
  scopeMismatch: mismatch,
});

describe("peakRequestsPerMinute", () => {
  test("finds the busiest 60 seconds, not the average", () => {
    // 30 requests in the first 10 seconds, then one an hour later.
    const times = [...Array(30).keys()].map((i) => at(i / 3)).concat(at(3600));
    assert.equal(peakRequestsPerMinute(times), 30);
  });

  test("spread-out requests don't accumulate", () => {
    assert.equal(peakRequestsPerMinute([at(0), at(120), at(240)]), 1);
    assert.equal(peakRequestsPerMinute([]), 0);
  });
});

describe("summarizeTimeline and describeTimeline", () => {
  test("states the facts as numbers", () => {
    const requests = [request(0, "/a"), request(60, "/b"), request(120, "/a")];
    const stats = summarizeTimeline(requests);
    assert.deepEqual({ requests: stats.requests, distinctPaths: stats.distinctPaths, spanSeconds: stats.spanSeconds }, {
      requests: 3,
      distinctPaths: 2,
      spanSeconds: 120,
    });
    assert.equal(describeTimeline(stats).summary, "3 requests in 2 minutes, 2 distinct pages");
  });

  test("the rate flag only appears past the documented threshold, and says it's a heuristic", () => {
    const quiet = describeTimeline(summarizeTimeline([request(0, "/a"), request(30, "/b")]));
    assert.equal(quiet.rateFlag, null);

    const burst = [...Array(HIGH_RATE_PER_MINUTE).keys()].map((i) => request(i / 2, `/page-${i}`));
    const flagged = describeTimeline(summarizeTimeline(burst));
    assert.equal(flagged.rateFlag, "Unusually high request rate (heuristic)");
    assert.match(flagged.rateDetail ?? "", new RegExp(`${HIGH_RATE_PER_MINUTE}-per-minute threshold`));
  });

  /** The timeline shows evidence; it never reaches the conclusion for the owner. */
  test("nothing in the readout calls anyone a scraper or an attacker", () => {
    const burst = [...Array(120).keys()].map((i) => request(i / 4, `/page-${i}`));
    const readout = describeTimeline(summarizeTimeline(burst));
    assert.doesNotMatch(JSON.stringify(readout), /scraper|scraping|attack|malicious|abus|bad actor|steal/i);
    assert.match(readout.rateDetail ?? "", /Ordinary traffic can reach that too/);
  });

  test("counts requests outside a declared scope", () => {
    const stats = summarizeTimeline([request(0, "/schedule-tour"), request(5, "/account", "path-outside-scope")]);
    assert.equal(stats.outsideScope, 1);
  });

  test("formatSpan reads naturally", () => {
    assert.equal(formatSpan(45), "45 seconds");
    assert.equal(formatSpan(240), "4 minutes");
    assert.equal(formatSpan(7200), "2 hours");
  });
});
