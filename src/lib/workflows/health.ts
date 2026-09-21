/**
 * Whether a monitored workflow is running on the cadence its owner declared.
 *
 * ## Why this is a state machine and not a timestamp
 *
 * The agent-traffic collector shipped with a table of timestamps and no states,
 * and a broken collector sat unnoticed on a live site for weeks: "never
 * connected", "connected and quiet", and "stopped working" all render
 * identically as an empty table or a bare date. Finding out took a query
 * against the production database.
 *
 * So this module exists before any UI does, and the three states are explicit:
 *
 *   - **never-pinged** — set up, nothing has ever arrived
 *   - **on-schedule** — a ping arrived within the expected window
 *   - **overdue** — the window passed with no ping
 *
 * "Never pinged" is deliberately not folded into "overdue". They call for
 * different actions: one means the workflow step was never added or the URL is
 * wrong, the other means something that was working has stopped.
 *
 * ## What this is not
 *
 * The cadence is **declared by the owner and not verified by anything**, the
 * same honesty tier as an owner-registered agent label. TrustTab knows only
 * that pings arrive; whether "hourly" is what the workflow was supposed to do
 * is the owner's statement. The UI says so.
 *
 * There is also no alerting. Status is computed when someone looks, which
 * needs no scheduled job; emailing on the flip to overdue would, and the
 * current hosting plan can only run a job once a day with an hour of jitter.
 * Shipping best-effort alerting for a monitoring product would be worse than
 * shipping none, so none is shipped and the UI says that too.
 */

/** Cadences an owner can declare. Intervals only — see `WORKFLOW_CADENCE_LIMIT`. */
export const CADENCES = [
  { id: "5m", label: "Every 5 minutes", seconds: 300 },
  { id: "15m", label: "Every 15 minutes", seconds: 900 },
  { id: "1h", label: "Every hour", seconds: 3_600 },
  { id: "6h", label: "Every 6 hours", seconds: 21_600 },
  { id: "24h", label: "Every day", seconds: 86_400 },
  { id: "7d", label: "Every week", seconds: 604_800 },
] as const;

export type CadenceId = (typeof CADENCES)[number]["id"];

export function cadenceSeconds(id: CadenceId): number {
  return CADENCES.find((c) => c.id === id)?.seconds ?? 3_600;
}

export function cadenceLabel(id: CadenceId): string {
  return CADENCES.find((c) => c.id === id)?.label ?? id;
}

export function isCadenceId(value: unknown): value is CadenceId {
  return typeof value === "string" && CADENCES.some((c) => c.id === value);
}

/**
 * How late a ping may be before the workflow is called overdue.
 *
 * A fifth of the cadence, never less than five minutes. Ordinary jitter — a
 * queue backing up, a retry, a platform's own scheduler drifting — shouldn't
 * read as a failure, and a five-minute cadence with a one-minute grace would
 * flag constantly. The floor matters more than the proportion at short
 * cadences, which is why it exists.
 */
export const GRACE_FRACTION = 0.2;
export const MIN_GRACE_SECONDS = 300;

export function graceSeconds(cadence: number): number {
  return Math.max(MIN_GRACE_SECONDS, Math.round(cadence * GRACE_FRACTION));
}

/**
 * Stated plainly wherever a cadence appears. The same disclosure the
 * owner-registered agent labels carry, for the same reason.
 */
export const WORKFLOW_CADENCE_LIMIT =
  "You tell TrustTab how often this should run; nothing checks that against the workflow itself. TrustTab only knows when a ping arrives. Cadences are intervals — “every hour”, not “every day at 9am” — so a workflow on a wall-clock schedule is measured by the gap between runs.";

/** No alerting exists. Said in the UI rather than left to be discovered. */
export const WORKFLOW_NO_ALERTS =
  "Nothing is sent when a workflow goes overdue — this page is where you find out. Alerting isn't built.";

export type WorkflowState = "never-pinged" | "on-schedule" | "overdue";

export type WorkflowHealth = {
  state: WorkflowState;
  title: string;
  detail: string;
  /** Whether the owner needs to do something. */
  needsAttention: boolean;
  /** Seconds since the last ping, or null when none has arrived. */
  sinceLastPing: number | null;
  /** When a ping would start counting as late. Null when none has arrived. */
  dueBy: Date | null;
};

export type WorkflowHealthInput = {
  cadence: CadenceId;
  lastPingAt: Date | null;
  now?: Date;
};

function ago(seconds: number): string {
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
}

function overdueBy(seconds: number): string {
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
}

export function describeWorkflowHealth(input: WorkflowHealthInput): WorkflowHealth {
  const now = input.now ?? new Date();
  const cadence = cadenceSeconds(input.cadence);
  const grace = graceSeconds(cadence);

  if (!input.lastPingAt) {
    return {
      state: "never-pinged",
      title: "No ping has ever arrived",
      detail:
        "This workflow is set up here, but TrustTab has never heard from it. That usually means the HTTP request step hasn't been added yet, or it's pointing at a different URL — not that the workflow has failed.",
      needsAttention: true,
      sinceLastPing: null,
      dueBy: null,
    };
  }

  const since = Math.max(0, Math.round((now.getTime() - input.lastPingAt.getTime()) / 1000));
  const dueBy = new Date(input.lastPingAt.getTime() + (cadence + grace) * 1000);
  const late = since - (cadence + grace);

  if (late > 0) {
    return {
      state: "overdue",
      // Named as a fact about pings, not about the workflow: TrustTab can't see
      // whether it ran and failed to ping, or didn't run at all.
      title: `Overdue by ${overdueBy(late)}`,
      detail: `The last ping arrived ${ago(since)}, and on the cadence you declared another was expected by ${dueBy.toISOString().replace("T", " ").slice(0, 16)} UTC. TrustTab can't tell whether the workflow stopped running or ran without reaching us.`,
      needsAttention: true,
      sinceLastPing: since,
      dueBy,
    };
  }

  return {
    state: "on-schedule",
    title: `On schedule — last ping ${ago(since)}`,
    detail: "Pings are arriving within the window your declared cadence allows, including its grace period.",
    needsAttention: false,
    sinceLastPing: since,
    dueBy,
  };
}
