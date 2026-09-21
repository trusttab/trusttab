import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { describeWorkflowHealth } from "@/lib/workflows/health";
import { createWorkflow, deleteWorkflow, listWorkflows, recordPing, workflowForPingToken } from "@/lib/workflows/store";

/**
 * The heartbeat end to end, against a real database: a token resolves to its
 * workflow, a ping moves it out of "never pinged", and the three states follow
 * from stored data rather than from anything a test hands them.
 */

const USER = "itest-workflow-user";

describe("workflow heartbeats", () => {
  before(async () => {
    await db.delete(users).where(eq(users.id, USER));
    await db.insert(users).values({ id: USER, name: "Workflow Tester", email: "itest-workflow@example.test", emailVerified: true });
  });

  after(async () => {
    await db.delete(users).where(eq(users.id, USER)); // cascades to workflows and pings
    await db.$client.end();
  });

  test("a new workflow has never been pinged, and says so", async () => {
    const created = await createWorkflow(USER, "Nightly sync", "24h");
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const [row] = await listWorkflows(USER);
    assert.equal(row.lastPingAt, null);
    assert.equal(row.pingCount, 0);
    assert.equal(describeWorkflowHealth({ cadence: "24h", lastPingAt: row.lastPingAt }).state, "never-pinged");
  });

  test("the issued token resolves to its workflow, and nothing else does", async () => {
    const created = await createWorkflow(USER, "Token check", "1h");
    assert.ok(created.ok);
    if (!created.ok) return;

    const found = await workflowForPingToken(created.token);
    assert.equal(found?.id, created.id);

    // Right shape, wrong secret.
    const [id, secret] = [created.token.slice(0, 36), created.token.slice(37)];
    const tampered = `${id}.${secret.slice(0, -1)}${secret.at(-1) === "A" ? "B" : "A"}`;
    assert.equal(await workflowForPingToken(tampered), null);

    for (const bad of ["", "nonsense", `${id}.short`, null, 42]) {
      assert.equal(await workflowForPingToken(bad), null, `rejected: ${String(bad)}`);
    }
  });

  test("a ping moves the workflow onto the schedule and is counted", async () => {
    const created = await createWorkflow(USER, "Ping me", "1h");
    assert.ok(created.ok);
    if (!created.ok) return;

    await recordPing(created.id);
    const [row] = (await listWorkflows(USER)).filter((w) => w.id === created.id);
    assert.ok(row.lastPingAt, "the ping was recorded");
    assert.equal(row.pingCount, 1);
    assert.equal(describeWorkflowHealth({ cadence: "1h", lastPingAt: row.lastPingAt }).state, "on-schedule");

    await recordPing(created.id);
    const [again] = (await listWorkflows(USER)).filter((w) => w.id === created.id);
    assert.equal(again.pingCount, 2);
  });

  /** The distinction that a bare timestamp table loses. */
  test("a workflow that pinged long ago is overdue, not 'never pinged'", async () => {
    const created = await createWorkflow(USER, "Went quiet", "1h");
    assert.ok(created.ok);
    if (!created.ok) return;

    await recordPing(created.id, new Date(Date.now() - 6 * 3600 * 1000));
    const [row] = (await listWorkflows(USER)).filter((w) => w.id === created.id);
    const health = describeWorkflowHealth({ cadence: "1h", lastPingAt: row.lastPingAt });
    assert.equal(health.state, "overdue");
    assert.notEqual(health.state, "never-pinged");
    assert.ok(row.lastPingAt, "it has a timestamp — which is exactly why the state has to be explicit");
  });

  test("a workflow belongs to its owner alone", async () => {
    const created = await createWorkflow(USER, "Mine", "1h");
    assert.ok(created.ok);
    if (!created.ok) return;
    assert.equal(await deleteWorkflow("someone-else", created.id), false, "another account cannot delete it");
    assert.equal(await deleteWorkflow(USER, created.id), true);
    assert.equal(await workflowForPingToken(created.token), null, "and its ping URL stops working");
  });

  test("a bad name or cadence is refused before anything is stored", async () => {
    const before = (await listWorkflows(USER)).length;
    assert.equal((await createWorkflow(USER, "x", "1h")).ok, false);
    assert.equal((await createWorkflow(USER, "Fine name", "every-hour")).ok, false);
    assert.equal((await listWorkflows(USER)).length, before, "nothing was created");
  });
});
