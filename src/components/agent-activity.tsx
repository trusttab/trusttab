import { DECLARED_INTENT_LIMIT, DECLARED_INTENT_NOTE, MISMATCH_NOTE } from "@/lib/agent-traffic/display";
import type { AgentActivity } from "@/lib/agent-traffic/queries";

const MISMATCH_LABELS: Record<AgentActivity["mismatches"][number]["reason"], string> = {
  "path-outside-scope": "fell outside the declared scope",
  "purpose-not-declared": "went to a path this site publishes under a purpose the agent didn't declare",
};

/**
 * Server component: what each verified agent declared and what it actually
 * requested. Mismatches are shown as the difference between the two, never as
 * a characterisation of the agent (see MISMATCH_NOTE).
 */
export function AgentActivityPanel({ agents, days }: { agents: AgentActivity[]; days: number }) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Verified agents, by declared intent</h2>
        <p className="mt-1 text-sm text-zinc-600">{DECLARED_INTENT_NOTE}</p>
      </div>

      {agents.length === 0 ? (
        <p className="text-sm text-zinc-500">No verified agents requested your pages in the last {days} days.</p>
      ) : (
        <ul className="space-y-3">
          {agents.map((agent) => (
            <li key={agent.identity} className="space-y-2 rounded-md border border-zinc-200 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm">{agent.identity}</span>
                <span className="text-xs text-zinc-500">
                  {agent.requests} request{agent.requests === 1 ? "" : "s"} · last seen {agent.lastSeen.toISOString().replace("T", " ").slice(0, 16)} UTC
                </span>
              </div>

              <p className="text-xs text-zinc-600">
                Declared:{" "}
                {agent.declarations.length > 0 ? (
                  <span className="font-medium text-zinc-900">{agent.declarations.join(" / ")}</span>
                ) : (
                  <span className="text-zinc-500">nothing — declaring is optional, and signed traffic without one is ordinary</span>
                )}
              </p>

              {agent.paths.length > 0 && (
                <p className="text-xs text-zinc-600">
                  Requested: {agent.paths.map((path) => `${path.path} (${path.requests})`).join(", ")}
                </p>
              )}

              {agent.mismatches.map((mismatch) => (
                <p key={mismatch.reason} className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  {mismatch.requests} request{mismatch.requests === 1 ? "" : "s"} {MISMATCH_LABELS[mismatch.reason]}
                  {mismatch.declared ? `. Declared: ${mismatch.declared}` : ""}
                  {mismatch.examplePath ? `. For example: ${mismatch.examplePath}` : ""}.
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-zinc-500">
        {MISMATCH_NOTE} {DECLARED_INTENT_LIMIT}
      </p>
    </section>
  );
}
