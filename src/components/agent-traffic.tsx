import Link from "next/link";

import { REGISTRY_SCOPE_NOTE, TIER_LABELS, TIER_NOTES } from "@/lib/agent-traffic/display";
import { AGENT_TRAFFIC_RANGES, type AgentGroup, type AgentTrafficSummary } from "@/lib/agent-traffic/queries";

const formatDate = (date: Date) => date.toISOString().replace("T", " ").slice(0, 16);

function GroupTable({ groups, identityHeading }: { groups: AgentGroup[]; identityHeading: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-zinc-500">
          <tr>
            <th className="py-1.5 pr-3 font-medium">{identityHeading}</th>
            <th className="py-1.5 pr-3 font-medium">Requests</th>
            <th className="py-1.5 pr-3 font-medium">Last seen (UTC)</th>
            <th className="py-1.5 font-medium">Why</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {groups.map((group) => (
            <tr key={`${group.identity}-${group.signal ?? ""}`}>
              <td className="py-1.5 pr-3 font-mono">{group.identity}</td>
              <td className="py-1.5 pr-3 tabular-nums">{group.requests}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{formatDate(group.lastSeen)}</td>
              <td className="py-1.5 text-zinc-600">{group.signal ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Server component: who has been requesting this site's manifest and registry
 * entry, split into what was cryptographically verified and what is only an
 * estimate. The two are never merged into one number, and there is no "human
 * traffic" figure, because nothing here can establish that.
 */
export function AgentTraffic({ siteId, summary }: { siteId: string; summary: AgentTrafficSummary }) {
  const { totals } = summary;

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Agent traffic</h2>
          <p className="mt-1 text-sm text-zinc-600">{REGISTRY_SCOPE_NOTE}</p>
        </div>
        <div className="flex gap-1 text-xs">
          {AGENT_TRAFFIC_RANGES.map((days) => (
            <Link
              key={days}
              href={`/dashboard/${siteId}?agentDays=${days}`}
              scroll={false}
              className={`rounded-md border px-2 py-1 ${
                summary.days === days ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
              }`}
            >
              {days} days
            </Link>
          ))}
        </div>
      </div>

      {summary.total === 0 ? (
        <p className="text-sm text-zinc-500">No requests to this site&apos;s TrustTab endpoints in the last {summary.days} days.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["verified", "likely_automated", "unclassified", "trusttab"] as const).map((tier) => (
              <div key={tier} className="rounded-md border border-zinc-200 p-3">
                <dt className="text-xs text-zinc-500">{TIER_LABELS[tier]}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{totals[tier]}</dd>
              </div>
            ))}
          </dl>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{TIER_LABELS.verified}</h3>
            <p className="text-xs text-zinc-600">{TIER_NOTES.verified}</p>
            {summary.verified.length > 0 ? (
              <GroupTable groups={summary.verified} identityHeading="Agent identity" />
            ) : (
              <p className="text-sm text-zinc-500">No signed requests in this period.</p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{TIER_LABELS.likely_automated}</h3>
            <p className="text-xs text-zinc-600">{TIER_NOTES.likely_automated}</p>
            {summary.likelyAutomated.length > 0 ? (
              <GroupTable groups={summary.likelyAutomated} identityHeading="Matched" />
            ) : (
              <p className="text-sm text-zinc-500">Nothing matched in this period.</p>
            )}
          </div>

          <p className="text-xs text-zinc-500">
            {TIER_NOTES.unclassified} {TIER_NOTES.trusttab}
          </p>
        </>
      )}
    </section>
  );
}
