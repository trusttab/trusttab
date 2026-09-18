import Link from "next/link";

import { TIER_LABELS } from "@/lib/agent-traffic/display";
import { AGENT_TRAFFIC_WINDOWS, windowLabel, type AgentTrafficRange, type AgentVolume } from "@/lib/agent-traffic/queries";
import { describeTimeline, summarizeTimeline, type TimelineRequest } from "@/lib/agent-traffic/timeline";

const time = (at: Date) => at.toISOString().replace("T", " ").slice(0, 19);

/**
 * Server component: agents ranked by request volume, and one agent's requests
 * in time order. Owner-only, like the rest of the site dashboard.
 */
export function AgentTimelinePanel({
  siteId,
  range,
  agents,
  selected,
  requests,
}: {
  siteId: string;
  range: AgentTrafficRange;
  agents: AgentVolume[];
  /** The agent whose timeline is shown, if the owner picked one. */
  selected: string | null;
  requests: TimelineRequest[];
}) {
  const base = `/dashboard/${siteId}`;
  const readout = selected ? describeTimeline(summarizeTimeline(requests)) : null;

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Agent sessions</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Agents by request volume on your own pages, {windowLabel(range)}. Open one to see its requests in order.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {AGENT_TRAFFIC_WINDOWS.map((option) => (
            <Link
              key={option}
              href={`${base}?window=${option}${selected ? `&agent=${encodeURIComponent(selected)}` : ""}`}
              scroll={false}
              className={`rounded-md border px-2 py-1 ${
                range === option ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
              }`}
            >
              {option}
            </Link>
          ))}
        </div>
      </div>

      {agents.length === 0 ? (
        <p className="text-sm text-zinc-500">No identified agents requested your pages in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Agent</th>
                <th className="py-1.5 pr-3 font-medium">How it was identified</th>
                <th className="py-1.5 pr-3 font-medium">Requests</th>
                <th className="py-1.5 pr-3 font-medium">Distinct pages</th>
                <th className="py-1.5 font-medium">Last seen (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {agents.map((agent) => (
                <tr key={`${agent.identity}-${agent.tier}`} className={selected === agent.identity ? "bg-zinc-50" : undefined}>
                  <td className="py-1.5 pr-3">
                    <Link className="font-mono underline" href={`${base}?window=${range}&agent=${encodeURIComponent(agent.identity)}`} scroll={false}>
                      {agent.identity}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-zinc-600">{TIER_LABELS[agent.tier]}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{agent.requests}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{agent.distinctPaths}</td>
                  <td className="py-1.5 whitespace-nowrap">{time(agent.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && readout && (
        <div className="space-y-3 border-t border-zinc-200 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-sm">{selected}</h3>
            <Link className="text-xs text-zinc-500 underline" href={`${base}?window=${range}`} scroll={false}>
              Close timeline
            </Link>
          </div>

          <p className="text-sm font-medium">{readout.summary}</p>
          {readout.rateFlag && (
            <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              <strong>{readout.rateFlag}</strong>
              <p className="mt-0.5">{readout.rateDetail}</p>
            </div>
          )}

          {requests.length === 0 ? (
            <p className="text-sm text-zinc-500">No requests from this agent in this window.</p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white text-zinc-500">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Time (UTC)</th>
                    <th className="py-1.5 pr-3 font-medium">Method</th>
                    <th className="py-1.5 pr-3 font-medium">Path</th>
                    <th className="py-1.5 font-medium">Declared scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {requests.map((request, index) => (
                    <tr key={`${request.at.toISOString()}-${index}`} className={request.scopeMismatch ? "bg-amber-50" : undefined}>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{time(request.at)}</td>
                      <td className="py-1.5 pr-3">{request.method ?? "—"}</td>
                      <td className="py-1.5 pr-3 font-mono">{request.path ?? "—"}</td>
                      <td className="py-1.5 text-zinc-600">
                        {request.declaredIntent ? (request.scopeMismatch ? "outside the declared scope" : "inside the declared scope") : "none declared"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-zinc-500">
            Newest requests last, up to 500. Requests outside a declared scope are highlighted; a declaration is only shown when the agent signed it.
          </p>
        </div>
      )}
    </section>
  );
}
