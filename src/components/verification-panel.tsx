import type { verificationRuns } from "@/db/schema";

import { RecheckButton } from "./recheck-button";
import { StatusPill } from "./status-pill";

type Run = typeof verificationRuns.$inferSelect;

/** Server component: latest verification results plus the re-check button. */
export function VerificationPanel({
  siteId,
  domain,
  run,
  canRun,
}: {
  siteId: string;
  domain: string;
  run: Run | undefined;
  /** False until a manifest has been published. */
  canRun: boolean;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Verification checks</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {run
              ? `Last run ${run.runAt.toLocaleString()} against the live site.`
              : canRun
                ? `Run the checks against https://${domain} to get verified.`
                : "Publish a manifest first."}
          </p>
        </div>
        {canRun && <RecheckButton siteId={siteId} />}
      </div>

      {run && (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
          {run.resultsJson.checks.map((check) => (
            <li key={check.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={check.passed ? "good" : "bad"}>{check.passed ? "Pass" : "Fail"}</StatusPill>
                <span className="text-sm font-medium">{check.label}</span>
              </div>
              <p className="text-sm text-zinc-600">{check.message}</p>
              {check.details.length > 0 && (
                <ul className="space-y-1.5 pl-1">
                  {check.details.map((detail, i) => (
                    <li key={i} className="text-xs">
                      <span className={detail.passed ? "text-emerald-700" : "text-red-700"}>
                        {detail.passed ? "✓" : "✗"}
                      </span>{" "}
                      <span className="font-mono break-all">{detail.subject}</span>
                      <span className="block pl-4 whitespace-pre-line text-zinc-600">{detail.message}</span>
                      {detail.note && <span className="block pl-4 text-amber-700">{detail.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
