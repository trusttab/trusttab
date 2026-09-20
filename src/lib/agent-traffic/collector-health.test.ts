import assert from "node:assert/strict";
import { test } from "node:test";

import { COLLECTOR_SILENT_AFTER_HOURS, describeCollectorHealth } from "./collector-health";

const now = new Date("2026-09-20T18:00:00Z");
const agoBy = (ms: number) => new Date(now.getTime() - ms);
const health = (over: Partial<Parameters<typeof describeCollectorHealth>[0]> = {}) =>
  describeCollectorHealth({ collectionEnabled: true, lastSeenAt: agoBy(60_000), hitsInWindow: 5, now, ...over });

test("collection off says so and asks for nothing", () => {
  const result = health({ collectionEnabled: false });
  assert.equal(result.state, "off");
  assert.equal(result.needsAttention, false);
});

/**
 * The case this module exists for. leasetab.com sat here for weeks: collection
 * on, token in the dashboard, Worker deployed, nothing ever recorded, and no
 * indication anywhere that anything was wrong.
 */
test("never having connected is stated plainly, and asks for attention", () => {
  const result = health({ lastSeenAt: null, hitsInWindow: 0 });
  assert.equal(result.state, "never");
  assert.equal(result.needsAttention, true);
  assert.match(result.title, /never/i);
  assert.match(result.detail, /token/i, "and says what usually causes it");
});

/**
 * The distinction rows alone cannot make, and the reason contact is tracked
 * separately: a connected collector with nothing to say looks identical, in the
 * hits table, to one that has never worked.
 */
test("connected-but-quiet is not confused with never connected", () => {
  const quiet = health({ hitsInWindow: 0 });
  assert.equal(quiet.state, "quiet");
  assert.equal(quiet.needsAttention, false);
  assert.match(quiet.detail, /ordinary result/i);
  assert.notEqual(quiet.state, health({ lastSeenAt: null, hitsInWindow: 0 }).state);
});

test("a collector that has gone silent is distinguished from one that never worked", () => {
  const silent = health({ lastSeenAt: agoBy((COLLECTOR_SILENT_AFTER_HOURS + 1) * 3_600_000), hitsInWindow: 0 });
  assert.equal(silent.state, "silent");
  assert.equal(silent.needsAttention, true);
  assert.match(silent.detail, /was working before/i, "so the owner doesn't re-do the token for nothing");
});

test("a reporting collector is quiet about itself", () => {
  const result = health();
  assert.equal(result.state, "reporting");
  assert.equal(result.needsAttention, false);
});

test("only the states the owner must act on ask for attention", () => {
  const cases = [
    health({ collectionEnabled: false }),
    health({ lastSeenAt: null, hitsInWindow: 0 }),
    health({ lastSeenAt: agoBy((COLLECTOR_SILENT_AFTER_HOURS + 1) * 3_600_000) }),
    health({ hitsInWindow: 0 }),
    health(),
  ];
  assert.deepEqual(
    cases.map((c) => [c.state, c.needsAttention]),
    [["off", false], ["never", true], ["silent", true], ["quiet", false], ["reporting", false]],
  );
});

test("elapsed time reads naturally at every scale", () => {
  const titleFor = (ms: number) => health({ lastSeenAt: agoBy(ms) }).title;
  assert.match(titleFor(10_000), /just now/);
  assert.match(titleFor(20 * 60_000), /20 minutes ago/);
  assert.match(titleFor(3 * 3_600_000), /3 hours ago/);
  assert.match(titleFor(5 * 86_400_000), /5 days ago/);
});
