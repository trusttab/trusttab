import { ExplainButton } from "./explain-button";
import { RecheckButton } from "./recheck-button";
import type { SiteSummary, SummaryTone } from "@/lib/verification/summary";

const tones: Record<SummaryTone, { box: string; dot: string }> = {
  good: { box: "border-emerald-200 bg-emerald-50", dot: "bg-emerald-500" },
  info: { box: "border-blue-200 bg-blue-50", dot: "bg-blue-500" },
  bad: { box: "border-amber-300 bg-amber-50", dot: "bg-amber-500" },
  neutral: { box: "border-zinc-200 bg-white", dot: "bg-zinc-400" },
};

/**
 * The first thing an owner sees on a site page: what is true right now, what to
 * do about it, and what their badge is showing visitors — in plain words.
 *
 * Everything technical it summarises is still on the page, under "Technical
 * details". This changes the order, not what is available.
 */
export function SiteSummaryPanel({
  siteId,
  summary,
  badgeUrl,
  canRun,
  assistantEnabled,
  agentLine,
}: {
  siteId: string;
  summary: SiteSummary;
  /** The live badge image, when the site has a public registry entry. */
  badgeUrl: string | null;
  canRun: boolean;
  assistantEnabled: boolean;
  /** One line about agent traffic, when collection is on. */
  agentLine: string | null;
}) {
  const tone = tones[summary.tone];

  return (
    <section className={`space-y-4 rounded-lg border p-5 ${tone.box}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-64 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} aria-hidden />
            <h2 className="text-lg font-semibold">{summary.headline}</h2>
          </div>
          <p className="text-sm text-zinc-700">{summary.detail}</p>
        </div>

        {badgeUrl && (
          <div className="space-y-1">
            {/* The badge is served as SVG from this app; next/image would add nothing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={badgeUrl} alt={`Your TrustTab badge, currently showing ${summary.badgeText ?? "no status"}`} width={136} height={20} />
            <p className="text-xs text-zinc-500">What visitors see</p>
          </div>
        )}
      </div>

      {summary.actions.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-zinc-200 bg-white/70 p-3">
          <h3 className="text-xs font-medium text-zinc-500 uppercase">What to do next</h3>
          <ul className="space-y-1 text-sm text-zinc-800">
            {summary.actions.map((action, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden>→</span>
                <span>
                  {action.text}
                  {action.target && (
                    <a href={`#${action.target}`} className="ml-1.5 text-xs text-zinc-500 underline">
                      show me
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {agentLine && <p className="text-sm text-zinc-600">{agentLine}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {canRun && <RecheckButton siteId={siteId} />}
        {assistantEnabled && <ExplainButton />}
      </div>
    </section>
  );
}
