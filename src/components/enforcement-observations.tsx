import type { EnforcementObservations } from "@/lib/agent-traffic/queries";

const time = (at: Date) => at.toISOString().replace("T", " ").slice(0, 19);

const REASON_TEXT: Record<string, string> = {
  "path-outside-scope": "outside the declared scope",
  "purpose-not-declared": "a purpose the agent didn't declare",
};

const describe = (reason: string | null) => (reason ? REASON_TEXT[reason] ?? reason : "nothing to report");

/**
 * Observe-only enforcement: what the site's own edge concluded, next to what
 * TrustTab concluded about the same requests.
 *
 * Nothing here was acted on. Blocking is not built, and this panel exists to
 * answer the question that has to be settled before it is: would an edge
 * deciding on its own have been right?
 */
export function EnforcementObservationsPanel({
  observations,
  windowText,
}: {
  observations: EnforcementObservations;
  windowText: string;
}) {
  const { observed, edgeWouldBlock, serverMismatch, disagreements } = observations;

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Enforcement, in observe-only mode</h2>
        <p className="mt-1 text-sm text-zinc-600">
          What your edge would have concluded {windowText}, had blocking existed. It doesn&apos;t: nothing here was
          refused, delayed or altered, and no code on either side can do so yet.
        </p>
      </div>

      {observed === 0 ? (
        <p className="text-sm text-zinc-500">
          Your collector hasn&apos;t reported any edge conclusions in this window. That is the default: observe-only
          evaluation runs only if you set <code className="font-mono text-xs">TRUSTTAB_FEED=1</code> on the Worker, and
          it stops on its own whenever its rule feed is more than a few minutes old.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Requests evaluated at your edge", value: observed },
              { label: "Your edge would have refused", value: edgeWouldBlock },
              { label: "TrustTab found outside a declared scope", value: serverMismatch },
            ].map((stat) => (
              <div key={stat.label} className="rounded-md border border-zinc-200 p-3">
                <p className="text-2xl font-semibold tabular-nums">{stat.value}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{stat.label}</p>
              </div>
            ))}
          </div>

          {disagreements.length === 0 ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Your edge and TrustTab reached the same conclusion on every request they both saw. That is what has to
              hold, repeatedly and on real traffic, before an edge is trusted to refuse anything.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>
                  {disagreements.length === 1 ? "One request" : `${disagreements.length} requests`} where your edge and
                  TrustTab disagreed
                </strong>
                <p className="mt-0.5 text-xs">
                  TrustTab checks the declaration against the agent&apos;s verified signature; your edge reads it as
                  presented, because it doesn&apos;t verify signatures yet. Where they differ, TrustTab is right — and
                  an edge acting alone would have got these wrong.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Time (UTC)</th>
                      <th className="py-1.5 pr-3 font-medium">Path</th>
                      <th className="py-1.5 pr-3 font-medium">Your edge said</th>
                      <th className="py-1.5 font-medium">TrustTab said</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {disagreements.map((row, index) => (
                      <tr key={`${row.at.toISOString()}-${index}`}>
                        <td className="py-1.5 pr-3 whitespace-nowrap">{time(row.at)}</td>
                        <td className="py-1.5 pr-3 font-mono">{row.path ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-amber-800">{describe(row.edge)}</td>
                        <td className="py-1.5 text-zinc-700">{describe(row.server)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-zinc-500">
        Blocking is a separate piece of work that starts only once these observations have been reviewed against real
        traffic. Until then &ldquo;Protection&rdquo; stays listed as not built.
      </p>
    </section>
  );
}
