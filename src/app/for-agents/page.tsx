import type { Metadata } from "next";
import Link from "next/link";

import { DarkPanel, Eyebrow, SectionHeading, Terminal } from "@/components/marketing";
import { AGENT_DISCLAIMER, AGENT_TIER_EXAMPLES } from "@/lib/landing/audiences";

export const metadata: Metadata = {
  title: "For agent builders — TrustTab",
  description:
    "Publish a Web Bot Auth key directory and TrustTab verifies your agent's signature on every request it sees, so sites recognise it by name instead of leaving it unclassified.",
};

/**
 * The three ways a site can end up describing an agent, drawn so the ranking is
 * visible before it is read: a fact reads as one, an estimate is marked as one,
 * and "unclassified" is quiet because it asserts nothing.
 */
const strengthStyle = {
  none: { row: "", dot: "bg-zinc-300", text: "text-zinc-500" },
  estimate: { row: "bg-amber-50/50", dot: "bg-amber-400", text: "text-amber-800" },
  fact: { row: "bg-emerald-50/60", dot: "bg-emerald-500", text: "text-emerald-800" },
} as const;

export default function ForAgents() {
  return (
    <div data-shell="wide" className="space-y-20 pb-8">
      <section className="space-y-6 pt-10 sm:pt-16">
        <Eyebrow>For companies building AI agents</Eyebrow>
        <h1 className="max-w-3xl text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
          Prove the agent is really yours.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-zinc-600">
          When your agent fetches a page, all the site sees is a user agent string that anyone can copy. Web Bot Auth
          lets it present a signature instead, checked against keys you publish yourself. TrustTab verifies that
          signature on every request it sees, and tells the site your agent&apos;s name instead of
          &ldquo;unclassified&rdquo;.
        </p>
      </section>

      <section className="space-y-6">
        <SectionHeading title="How a site running TrustTab sees your agent" />
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200">
              <tr className="text-[11px] tracking-[0.12em] text-zinc-400 uppercase">
                <th className="px-6 py-3 font-medium">Your agent</th>
                <th className="px-6 py-3 font-medium">What the site&apos;s dashboard says</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {AGENT_TIER_EXAMPLES.map((example) => {
                const style = strengthStyle[example.strength];
                return (
                  <tr key={example.agent} className={style.row}>
                    <td className="px-6 py-4 align-top">
                      <span className="flex items-center gap-2.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                        <span className={example.strength === "fact" ? "font-semibold text-zinc-900" : "text-zinc-700"}>
                          {example.agent}
                        </span>
                      </span>
                    </td>
                    <td className={`px-6 py-4 align-top leading-relaxed ${style.text}`}>{example.shown}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
          Signing is the one that isn&apos;t a guess. Everything below it is an estimate, and is labelled as one
          wherever it appears.
        </p>
      </section>

      <section className="space-y-6">
        <SectionHeading title="Check your setup — no account needed" />
        <p className="max-w-2xl leading-relaxed text-zinc-600">
          Send a signed request to <code className="font-mono text-sm">GET /api/agent-check</code> and TrustTab tells
          you exactly what it saw: whether the signature verified, which identity it resolved to, which components the
          signature actually covered, and why it failed if it did. That is the same verification path a real site&apos;s
          traffic goes through. Nothing is stored.
        </p>
        <Terminal>
          {`$ curl -sS https://trusttab-mu.vercel.app/api/agent-check \\
    -H 'Signature-Agent: "https://youragent.example"' \\
    -H 'Signature-Input: sig=("@authority" "signature-agent");keyid="…";…' \\
    -H 'Signature: sig=:…:'

{
  "verified": true,
  "identity": "https://youragent.example",
  "covered_components": ["@authority", "signature-agent"],
  "declared_intent": null
}`}
        </Terminal>
        <p className="max-w-2xl text-sm text-zinc-500">
          A failed check comes back with the reason and what to look at, not just a no.
        </p>
      </section>

      <section className="space-y-6">
        <SectionHeading title="Get listed for the requests you don't sign" />
        <p className="max-w-2xl leading-relaxed text-zinc-600">
          Fleets are rarely uniformly signed — a different service, a different HTTP client, a proxy that strips headers
          on retry. Listing your user agent in TrustTab&apos;s known-agent list means those requests read as your
          agent&apos;s name rather than &ldquo;unclassified&rdquo;.
        </p>
        <p className="max-w-2xl leading-relaxed text-zinc-600">
          It is the weaker tier and the dashboard says so wherever it appears: a user agent is self-reported and
          trivially forged, so a match is an estimate. Signing is what makes it a fact.
        </p>
        <p className="max-w-2xl leading-relaxed text-zinc-600">
          The list is a source file in a public repository. Open a pull request against{" "}
          <code className="font-mono text-sm">src/lib/agent-traffic/agents.ts</code>, or get in touch. One rule: an entry
          names your operator by the domain your key directory is served from. We decline entries claiming a name whose
          domain you can&apos;t demonstrate control of.
        </p>
        <p>
          <a
            href="https://github.com/trusttab/trusttab/blob/main/src/lib/agent-traffic/agents.ts"
            className="text-sm font-medium underline underline-offset-4"
          >
            See the list →
          </a>
        </p>
      </section>

      <DarkPanel>
        <div className="max-w-3xl space-y-4">
          <SectionHeading title="What TrustTab does not do" tone="dark" />
          <p className="text-[15px] leading-relaxed text-zinc-300">{AGENT_DISCLAIMER}</p>
          <p className="text-sm text-zinc-500">
            Related: <Link href="/for-security" className="underline underline-offset-4">what site owners see</Link>,
            and the <Link href="/" className="underline underline-offset-4">five stages</Link> this fits into.
          </p>
        </div>
      </DarkPanel>
    </div>
  );
}
