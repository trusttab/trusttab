import Link from "next/link";

import { REGISTRY_SCOPE_NOTE, SITE_SCOPE_NOTE, TIER_LABELS, TIER_NOTES } from "@/lib/agent-traffic/display";
import { AGENT_TRAFFIC_WINDOWS, windowLabel, type AgentGroup, type AgentTrafficSummary } from "@/lib/agent-traffic/queries";

import { AgentTrafficCollection } from "./agent-traffic-collection";

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
function Breakdown({ summary }: { summary: AgentTrafficSummary }) {
  const { totals } = summary;
  const scope = summary.source === "registry" ? REGISTRY_SCOPE_NOTE : SITE_SCOPE_NOTE;

  if (summary.total === 0) {
    return (
      <p className="text-sm text-zinc-500">
        {scope} Nothing in the {windowLabel(summary.days)}.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">{scope}</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["verified", "likely_automated", "owner_identified", "unclassified", "trusttab"] as const).map((tier) => (
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
    </div>
  );
}

export function AgentTraffic({
  siteId,
  summary,
  siteSummary,
  collectionEnabled,
}: {
  siteId: string;
  summary: AgentTrafficSummary;
  /** Present only when the owner has site-wide collection turned on. */
  siteSummary: AgentTrafficSummary | null;
  collectionEnabled: boolean;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Agent traffic</h2>
          <p className="mt-1 text-sm text-zinc-600">Who has been requesting this site, and how that was established.</p>
        </div>
        <div className="flex gap-1 text-xs">
          {AGENT_TRAFFIC_WINDOWS.map((range) => (
            <Link
              key={range}
              href={`/dashboard/${siteId}?window=${range}`}
              scroll={false}
              className={`rounded-md border px-2 py-1 ${
                summary.days === range ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
              }`}
            >
              {range}
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">TrustTab endpoints for this site</h3>
        <Breakdown summary={summary} />
      </div>

      {siteSummary && (
        <div className="space-y-2 border-t border-zinc-200 pt-4">
          <h3 className="text-sm font-medium">Your own pages</h3>
          <Breakdown summary={siteSummary} />
        </div>
      )}

      <AgentTrafficCollection siteId={siteId} enabled={collectionEnabled} />
    </section>
  );
}
