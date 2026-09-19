import Link from "next/link";

import { TIER_LABELS } from "@/lib/agent-traffic/display";
import { buildPathGraph, nodeLabel, type PathGraph } from "@/lib/agent-traffic/path-graph";
import { AGENT_TRAFFIC_WINDOWS, windowLabel, type AgentTrafficRange, type AgentVolume } from "@/lib/agent-traffic/queries";
import { describeTimeline, summarizeTimeline, type TimelineRequest } from "@/lib/agent-traffic/timeline";

const time = (at: Date) => at.toISOString().replace("T", " ").slice(0, 19);

/**
 * The walk drawn as SVG, on the server: coordinates come from `buildPathGraph`,
 * so there is no client JavaScript and no layout simulation. Pages requested
 * outside a declared scope use the same amber as the rows below.
 */
function PathGraphDrawing({ graph, description }: { graph: PathGraph; description: string }) {
  return (
    <svg
      viewBox={`0 0 ${graph.width} ${graph.height}`}
      width="100%"
      style={{ maxWidth: graph.width }}
      role="img"
      aria-label={description}
      className="overflow-visible"
    >
      <desc>{description}</desc>
      <defs>
        <marker id="agent-path-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="#a1a1aa" />
        </marker>
      </defs>

      {graph.edges.map((edge) => (
        <path
          key={`${edge.from}->${edge.to}`}
          d={`M${edge.x1},${edge.y1} Q${edge.cx},${edge.cy} ${edge.x2},${edge.y2}`}
          fill="none"
          stroke="#a1a1aa"
          strokeWidth={Math.min(3, 1 + (edge.count - 1) * 0.5)}
          markerEnd="url(#agent-path-arrow)"
          opacity={0.7}
        >
          <title>{`${edge.from} → ${edge.to}${edge.count > 1 ? ` (${edge.count} times)` : ""}`}</title>
        </path>
      ))}

      {graph.nodes.map((node) => (
        <g key={node.path}>
          <title>{`${node.order}. ${node.path} — ${node.visits} request${node.visits === 1 ? "" : "s"}${node.outsideScope ? ", outside the declared scope" : ""}`}</title>
          <circle
            cx={node.x}
            cy={node.y}
            r={17}
            fill={node.outsideScope ? "#fffbeb" : "#fafafa"}
            stroke={node.outsideScope ? "#fcd34d" : "#d4d4d8"}
            strokeWidth={node.visits > 1 ? 2 : 1}
          />
          <text x={node.x} y={node.y + 4} textAnchor="middle" fontSize="11" fill="#3f3f46">
            {node.order}
          </text>
          <text x={node.x} y={node.y + 32} textAnchor="middle" fontSize="10" fill="#71717a">
            {nodeLabel(node.path)}
          </text>
          {node.visits > 1 && (
            <text x={node.x} y={node.y + 44} textAnchor="middle" fontSize="9" fill="#a1a1aa">
              ×{node.visits}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/**
 * One agent's path through the site: which pages, in what order. The drawing is
 * for reading the shape of a session — a directory swept in order looks nothing
 * like a session that keeps returning to the same few pages — and it gives way
 * to the same facts in words once there is too much to draw legibly.
 */
function PathGraphSection({ requests }: { requests: TimelineRequest[] }) {
  const result = buildPathGraph(requests);
  if (result.kind === "empty") return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-zinc-700">Pages visited, in order</h4>
      {result.kind === "graph" ? (
        <>
          <div className="overflow-x-auto rounded-md border border-zinc-200 bg-white p-2">
            <PathGraphDrawing graph={result.graph} description={result.description} />
          </div>
          <p className="text-xs text-zinc-500">
            Numbered in the order each page was first requested; arrows follow the moves between them, and a thicker ring
            means the page was requested more than once. {result.description}
          </p>
        </>
      ) : (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-700">{result.description}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Not drawn: {result.reason}, so it would be an unreadable tangle. The requests themselves are listed below.
          </p>
        </div>
      )}
    </div>
  );
}

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

          {requests.length > 0 && <PathGraphSection requests={requests} />}

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
