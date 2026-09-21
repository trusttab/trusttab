import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CADENCES,
  GRACE_FRACTION,
  MIN_GRACE_SECONDS,
  WORKFLOW_CADENCE_LIMIT,
  WORKFLOW_NO_ALERTS,
  cadenceSeconds,
  describeWorkflowHealth,
  graceSeconds,
  isCadenceId,
  type CadenceId,
} from "./health";

const now = new Date("2026-09-21T12:00:00Z");
const agoBy = (seconds: number) => new Date(now.getTime() - seconds * 1000);
const health = (cadence: CadenceId, lastPingAt: Date | null) => describeWorkflowHealth({ cadence, lastPingAt, now });

/**
 * The reason this module exists. On the agent-traffic collector these three
 * situations rendered identically, and a broken collector went unnoticed for
 * weeks. They must never collapse into one another again.
 */
describe("the three states are distinct and never collapse", () => {
  test("never pinged is its own state, not overdue", () => {
    const never = health("1h", null);
    assert.equal(never.state, "never-pinged");
    assert.equal(never.sinceLastPing, null);
    assert.match(never.detail, /hasn't been added yet|different URL/i, "it says what usually causes it");
    assert.doesNotMatch(never.detail, /stopped/i, "and doesn't imply something broke");
  });

  test("a workflow that has stopped is overdue, not 'never pinged'", () => {
    const stopped = health("1h", agoBy(6 * 3600));
    assert.equal(stopped.state, "overdue");
    assert.notEqual(stopped.state, health("1h", null).state);
  });

  test("a quiet-but-healthy workflow is on schedule, and asks for nothing", () => {
    const fine = health("24h", agoBy(3600));
    assert.equal(fine.state, "on-schedule");
    assert.equal(fine.needsAttention, false);
  });

  test("all three produce different titles", () => {
    const titles = new Set([health("1h", null).title, health("1h", agoBy(60)).title, health("1h", agoBy(99999)).title]);
    assert.equal(titles.size, 3);
  });

  test("only the states an owner must act on ask for attention", () => {
    assert.equal(health("1h", null).needsAttention, true);
    assert.equal(health("1h", agoBy(99999)).needsAttention, true);
    assert.equal(health("1h", agoBy(60)).needsAttention, false);
  });
});

describe("the grace period", () => {
  test("a ping inside the grace window is still on schedule", () => {
    const cadence = cadenceSeconds("1h");
    const grace = graceSeconds(cadence);
    assert.equal(health("1h", agoBy(cadence + grace - 30)).state, "on-schedule");
    assert.equal(health("1h", agoBy(cadence + grace + 30)).state, "overdue");
  });

  test("it is a fifth of the cadence, with a floor that matters at short ones", () => {
    assert.equal(graceSeconds(3600), 3600 * GRACE_FRACTION);
    // A 5-minute cadence would otherwise get a 60-second grace and flag on any jitter.
    assert.equal(graceSeconds(300), MIN_GRACE_SECONDS);
    assert.ok(graceSeconds(300) > 300 * GRACE_FRACTION);
  });

  test("every cadence gets a usable grace", () => {
    for (const cadence of CADENCES) {
      assert.ok(graceSeconds(cadence.seconds) >= MIN_GRACE_SECONDS, `${cadence.id} has a floor`);
    }
  });
});

describe("what it says, and doesn't", () => {
  /**
   * TrustTab sees pings arriving or not arriving. Whether the workflow ran and
   * failed to reach us, or never ran, is not visible from here.
   */
  test("overdue is stated as a fact about pings, not a verdict on the workflow", () => {
    const overdue = health("1h", agoBy(6 * 3600));
    assert.match(overdue.detail, /can't tell whether/i);
    assert.doesNotMatch(overdue.title + overdue.detail, /\b(failed|broken|crashed|down|error)\b/i);
  });

  test("the cadence is disclosed as the owner's own statement", () => {
    assert.match(WORKFLOW_CADENCE_LIMIT, /nothing checks that against the workflow itself/i);
    assert.match(WORKFLOW_CADENCE_LIMIT, /only knows when a ping arrives/i);
  });

  test("the absence of alerting is stated, not left to be discovered", () => {
    assert.match(WORKFLOW_NO_ALERTS, /Nothing is sent/i);
    assert.match(WORKFLOW_NO_ALERTS, /isn't built/i);
  });

  test("interval-only scheduling is disclosed rather than implied", () => {
    assert.match(WORKFLOW_CADENCE_LIMIT, /every day at 9am|intervals/i);
  });
});

describe("cadence handling", () => {
  test("only known cadences are accepted", () => {
    assert.equal(isCadenceId("1h"), true);
    for (const bad of ["", "2h", "hourly", null, 3600, {}]) assert.equal(isCadenceId(bad), false, String(bad));
  });

  test("dueBy is the moment a ping starts counting as late", () => {
    const last = agoBy(60);
    const result = describeWorkflowHealth({ cadence: "1h", lastPingAt: last, now });
    assert.equal(result.dueBy?.getTime(), last.getTime() + (3600 + graceSeconds(3600)) * 1000);
    assert.equal(describeWorkflowHealth({ cadence: "1h", lastPingAt: null, now }).dueBy, null);
  });

  test("a ping from the future is not reported as negative time", () => {
    const result = describeWorkflowHealth({ cadence: "1h", lastPingAt: new Date(now.getTime() + 60_000), now });
    assert.equal(result.sinceLastPing, 0);
    assert.equal(result.state, "on-schedule");
  });
});
