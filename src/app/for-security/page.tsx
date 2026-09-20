import type { Metadata } from "next";
import Link from "next/link";

import { DarkPanel, Eyebrow, SectionHeading } from "@/components/marketing";
import { CITATIONS, CITATION_SCOPE_NOTE, SECURITY_LIMITS, SECURITY_SCOPE } from "@/lib/landing/audiences";

export const metadata: Metadata = {
  title: "For security and platform teams — TrustTab",
  description:
    "Visibility into agents arriving at your public site or API: classification with the confidence stated, per-agent session timelines, and declared intent with mismatches reported as fact.",
};

const FEATURES = [
  {
    title: "Classification, with the confidence stated",
    body: "Every request lands in one of three identified tiers, and the dashboard never blurs them. Verified means a valid Web Bot Auth signature, checked against keys the operator publishes. Likely automated means a known user agent or a published IP range — a good guess, not proof. Your own agents means a label you set for traffic you recognise, which is your word, not our verification. Everything else is “unclassified”, which means exactly that and nothing more.",
  },
  {
    title: "Session timelines, and the path an agent took",
    body: "Per agent: total requests, distinct pages, the span they arrived in, and every request in order with its method and path. A drawing shows the shape of the session — which pages, in what order — because a directory swept in sequence and a session that keeps returning to three pages look identical as a list of rows. One heuristic flag fires past a documented threshold (60 requests in any rolling 60 seconds) and says that it is a heuristic. Nothing here calls a visitor a scraper: rate and breadth are facts, and intent isn't visible from them.",
  },
  {
    title: "Declared intent, and mismatches as fact",
    body: "A signed agent can declare its purpose and scope. Because the declaration is covered by the signature, it can't be added or altered afterwards, and an unsigned one is dropped rather than shown. When a request falls outside the declared scope, you're told that, and only that — a mismatch can be a misconfigured agent, a redirect, or a deliberate deviation, and nothing here can tell which.",
  },
];

export default function ForSecurity() {
  return (
    <div data-shell="wide" className="space-y-20 pb-8">
      <section className="space-y-6 pt-10 sm:pt-16">
        <Eyebrow>For security and platform teams</Eyebrow>
        <h1 className="max-w-4xl text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
          See which agents are reaching your site, and what they said they came to do.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-zinc-600">
          Agents increasingly act on their own once deployed, and routinely do more than whoever deployed them intended.
          If they&apos;re reaching your public site or API, what you have today is a web server log and a user agent
          string that anyone can set.
        </p>
      </section>

      {/*
        The scope block sits above every feature on purpose. "Governing inbound
        agent traffic" is one imprecise sentence away from "agent governance",
        which is a different category this product doesn't touch.
      */}
      <section className="space-y-6 rounded-2xl border border-zinc-300 bg-white p-6 sm:p-10">
        <SectionHeading title="What this covers, and what it doesn't" />
        <dl className="grid gap-6 sm:grid-cols-2">
          {SECURITY_SCOPE.map((limit) => (
            <div key={limit.claim} className="border-l-2 border-zinc-200 pl-4">
              <dt className="text-sm font-semibold tracking-tight text-zinc-900">{limit.claim}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-zinc-600">{limit.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-6">
        <SectionHeading title="What you actually get" />
        <div className="space-y-4">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="rounded-xl border border-zinc-200 bg-white p-6">
              <h3 className="text-base font-semibold tracking-tight">{feature.title}</h3>
              <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-zinc-600">{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <SectionHeading title="Why this is worth watching" />
        <div className="grid gap-4 sm:grid-cols-2">
          {CITATIONS.map((citation) => (
            <figure key={citation.figure} className="rounded-xl border border-zinc-200 bg-white p-6">
              <p className="text-5xl font-semibold tracking-[-0.03em] tabular-nums">{citation.figure}</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-700">{citation.finding}</p>
              <figcaption className="mt-4 space-y-1.5 border-t border-zinc-100 pt-3 text-xs leading-relaxed text-zinc-500">
                <a href={citation.url} className="underline underline-offset-2">
                  {citation.source}
                </a>
                {citation.disclosure && <span className="block">{citation.disclosure}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600">{CITATION_SCOPE_NOTE}</p>
      </section>

      <DarkPanel>
        <div className="max-w-3xl space-y-4">
          <SectionHeading title="The honest limits" tone="dark" />
          <p className="text-[15px] leading-relaxed text-zinc-300">{SECURITY_LIMITS}</p>
          <p className="text-sm text-zinc-500">
            Related: <Link href="/for-agents" className="underline underline-offset-4">for agent builders</Link>, and
            the <Link href="/" className="underline underline-offset-4">five stages</Link> this fits into.
          </p>
        </div>
      </DarkPanel>
    </div>
  );
}
