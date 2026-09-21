import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { workflowPings, workflows } from "@/db/schema";
import { isCadenceId, type CadenceId } from "./health";

/**
 * Storage for Tier 1 workflow heartbeats.
 *
 * The ping token follows the collector token's shape exactly — `<id>.<secret>`,
 * with only a SHA-256 of the secret stored, shown once on creation. That was
 * chosen there so a leaked database can't be used to forge reports, and the
 * same reasoning applies: anyone holding a ping URL can make a workflow look
 * alive.
 */

export const MAX_WORKFLOWS_PER_USER = 25;
export const PING_RETENTION_DAYS = 30;
/** Enough to show a drill-down without becoming a log. */
export const MAX_PINGS_SHOWN = 50;

const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function issuePingToken(workflowId: string): { token: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  return { token: `${workflowId}.${secret}`, hash: hashSecret(secret) };
}

/**
 * Resolves a ping token to its workflow. Constant-time comparison, and one
 * answer for an unknown workflow and a wrong secret, so the endpoint can't be
 * used to discover which workflow ids exist.
 */
export async function workflowForPingToken(token: unknown) {
  if (typeof token !== "string" || token.length > 200) return null;
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const id = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 16) return null;

  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
  if (!workflow) return null;

  const expected = Buffer.from(workflow.pingTokenHash, "utf8");
  const actual = Buffer.from(hashSecret(secret), "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return workflow;
}

/**
 * Records a ping. Updates the workflow's own `last_ping_at` so status stays a
 * single-row read, and appends to the history.
 *
 * Pruning piggybacks on writes, as everywhere else here, so no scheduled job is
 * needed — which matters more than usual, because the hosting plan can't run
 * one more than daily.
 */
export async function recordPing(workflowId: string, at: Date = new Date()): Promise<void> {
  await db
    .update(workflows)
    .set({ lastPingAt: at, pingCount: sql`${workflows.pingCount} + 1` })
    .where(eq(workflows.id, workflowId));
  await db.insert(workflowPings).values({ workflowId, receivedAt: at });

  if (Math.random() < 0.02) {
    await db
      .delete(workflowPings)
      .where(lt(workflowPings.receivedAt, sql`now() - make_interval(days => ${PING_RETENTION_DAYS})`));
  }
}

export async function listWorkflows(userId: string) {
  return db.select().from(workflows).where(eq(workflows.userId, userId)).orderBy(desc(workflows.createdAt));
}

/** Scoped by user, so another account's workflow is simply not found. */
export async function getWorkflow(userId: string, workflowId: string) {
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)));
  return workflow ?? null;
}

export async function recentPings(workflowId: string) {
  return db
    .select({ receivedAt: workflowPings.receivedAt })
    .from(workflowPings)
    .where(eq(workflowPings.workflowId, workflowId))
    .orderBy(desc(workflowPings.receivedAt))
    .limit(MAX_PINGS_SHOWN);
}

export type CreateWorkflowResult =
  | { ok: true; id: string; token: string }
  | { ok: false; error: string };

export async function createWorkflow(userId: string, name: unknown, cadence: unknown): Promise<CreateWorkflowResult> {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length < 2 || trimmed.length > 80) return { ok: false, error: "Give the workflow a name of 2 to 80 characters." };
  if (!isCadenceId(cadence)) return { ok: false, error: "Choose one of the listed cadences." };

  const existing = await db.select({ id: workflows.id }).from(workflows).where(eq(workflows.userId, userId));
  if (existing.length >= MAX_WORKFLOWS_PER_USER) {
    return { ok: false, error: `You can monitor up to ${MAX_WORKFLOWS_PER_USER} workflows.` };
  }

  const [created] = await db
    .insert(workflows)
    .values({ userId, name: trimmed, cadence: cadence as CadenceId, pingTokenHash: "pending" })
    .returning({ id: workflows.id });

  // The token embeds the row id, so it can only be built once the row exists.
  const { token, hash } = issuePingToken(created.id);
  await db.update(workflows).set({ pingTokenHash: hash }).where(eq(workflows.id, created.id));
  return { ok: true, id: created.id, token };
}

export async function deleteWorkflow(userId: string, workflowId: string): Promise<boolean> {
  const deleted = await db
    .delete(workflows)
    .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
    .returning({ id: workflows.id });
  return deleted.length > 0;
}
