import type { manifestHits } from "@/db/schema";

type Hit = typeof manifestHits.$inferSelect;

/** Server component: recent requests to the site's public manifest and registry lookup. */
export function TrafficLog({
  hits,
  counts,
}: {
  hits: Hit[];
  /** Requests in the last 7 days, per endpoint. */
  counts: { manifest: number; verify: number };
}) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Traffic log</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Last 7 days: {counts.manifest} manifest fetch{counts.manifest === 1 ? "" : "es"}, {counts.verify} registry
          lookup{counts.verify === 1 ? "" : "s"}. Includes TrustTab&apos;s own verification runs.
        </p>
      </div>
      {hits.length === 0 ? (
        <p className="text-sm text-zinc-500">No requests yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Time (UTC)</th>
                <th className="py-1.5 pr-3 font-medium">Endpoint</th>
                <th className="py-1.5 pr-3 font-medium">IP</th>
                <th className="py-1.5 font-medium">User agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {hits.map((hit) => (
                <tr key={hit.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{hit.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                  <td className="py-1.5 pr-3">{hit.endpoint}</td>
                  <td className="py-1.5 pr-3 font-mono">{hit.requesterIp ?? "—"}</td>
                  <td className="max-w-md truncate py-1.5" title={hit.userAgent ?? undefined}>
                    {hit.userAgent ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
