import Link from "next/link";

import { AddWorkflow, DeleteWorkflow } from "@/components/workflow-monitor";
import { requireUser } from "@/lib/auth";
import { cadenceLabel, describeWorkflowHealth, type CadenceId, type WorkflowState } from "@/lib/workflows/health";
import { listWorkflows } from "@/lib/workflows/store";

export const metadata = { title: "Workflow monitoring — TrustTab" };

/**
 * Tier 1 workflow monitoring: a heartbeat per workflow, with an explicit state
 * for each one.
 *
 * The list deliberately leads with a state, not a timestamp. On the agent-
 * traffic collector a bare timestamp table made "never connected", "connected
 * and quiet" and "stopped working" indistinguishable, and a broken collector
 * went unnoticed for weeks. A row here says which of the three it is before it
 * says anything else.
 */

const TONE: Record<WorkflowState, { badge: string; dot: string; label: string }> = {
  "never-pinged": { badge: "bg-zinc-100 text-zinc-700 ring-zinc-200", dot: "bg-zinc-400", label: "Never pinged" },
  "on-schedule": { badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", label: "On schedule" },
  overdue: { badge: "bg-amber-50 text-amber-900 ring-amber-300", dot: "bg-amber-500", label: "Overdue" },
};

export default async function WorkflowsPage() {
  const user = await requireUser("/dashboard/workflows");
  const rows = await listWorkflows(user.id);

  const withHealth = rows.map((workflow) => ({
    workflow,
    health: describeWorkflowHealth({ cadence: workflow.cadence as CadenceId, lastPingAt: workflow.lastPingAt }),
  }));
  const needingAttention = withHealth.filter((r) => r.health.needsAttention).length;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← All sites
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Workflow monitoring</h1>
        <p className="max-w-2xl text-sm text-zinc-600">
          A workflow pings TrustTab each time it runs. If a ping doesn&apos;t arrive when you said it should, it shows
          as overdue here. This is a heartbeat: it sees pings arriving or not arriving, not what the workflow did.
        </p>
      </div>

      <AddWorkflow />

      {withHealth.length > 0 && (
        <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {withHealth.length} workflow{withHealth.length === 1 ? "" : "s"}
            </h2>
            <p className="text-sm text-zinc-600">
              {needingAttention === 0
                ? "All pinging on the cadence you declared."
                : `${needingAttention} need${needingAttention === 1 ? "s" : ""} a look.`}
            </p>
          </div>

          <ul className="divide-y divide-zinc-100">
            {withHealth.map(({ workflow, health }) => {
              const tone = TONE[health.state];
              return (
                <li key={workflow.id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden />
                      {tone.label}
                    </span>
                    <span className="font-medium">{workflow.name}</span>
                    <span className="text-xs text-zinc-500">
                      declared {cadenceLabel(workflow.cadence as CadenceId).toLowerCase()} · heartbeat (self-declared)
                    </span>
                    <span className="ml-auto">
                      <DeleteWorkflow id={workflow.id} name={workflow.name} />
                    </span>
                  </div>
                  <p className="text-sm text-zinc-700">{health.title}</p>
                  <p className="text-xs text-zinc-500">{health.detail}</p>
                  {workflow.pingCount > 0 && (
                    <p className="text-xs text-zinc-400 tabular-nums">
                      {workflow.pingCount} ping{workflow.pingCount === 1 ? "" : "s"} received in total
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
