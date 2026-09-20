import type { Metadata } from "next";
import Link from "next/link";

import { AGENT_DISCLAIMER, AGENT_TIER_EXAMPLES } from "@/lib/landing/audiences";

export const metadata: Metadata = {
  title: "For agent builders — TrustTab",
  description:
    "Publish a Web Bot Auth key directory and TrustTab verifies your agent's signature on every request it sees, so sites recognise it by name instead of leaving it unclassified.",
};

const strengthStyle = {
  none: "text-zinc-500",
  estimate: "text-amber-700",
  fact: "text-emerald-700",
} as const;

export default function ForAgents() {
  return (
    <div className="space-y-14">
      <section className="space-y-5 pt-6">
        <p className="text-sm font-medium text-zinc-500">For companies building AI agents</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Prove the agent is really yours.</h1>
        <p className="max-w-2xl text-lg text-zinc-600">
          When your agent fetches a page, all the site sees is a user agent string that anyone can copy. Web Bot Auth
          lets it present a signature instead, checked against keys you publish yourself. TrustTab verifies that
          signature on every request it sees, and tells the site your agent&apos;s name instead of
          &ldquo;unclassified&rdquo;.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">How a site running TrustTab sees your agent</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Your agent</th>
                <th className="px-4 py-2.5 font-medium">What the site&apos;s dashboard says</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {AGENT_TIER_EXAMPLES.map((example) => (
                <tr key={example.agent}>
                  <td className="px-4 py-3 align-top">
                    {example.strength === "fact" ? <strong>{example.agent}</strong> : example.agent}
                  </td>
                  <td className={`px-4 py-3 align-top ${strengthStyle[example.strength]}`}>{example.shown}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-2xl text-sm text-zinc-600">
          Signing is the one that isn&apos;t a guess. Everything below it is an estimate, and is labelled as one
          wherever it appears.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Check your setup — no account needed</h2>
        <p className="max-w-2xl text-zinc-600">
          Send a signed request to <code className="font-mono text-sm">GET /api/agent-check</code> and TrustTab tells
          you exactly what it saw: whether the signature verified, which identity it resolved to, which components the
          signature actually covered, and why it failed if it did. That is the same verification path a real site&apos;s
          traffic goes through. Nothing is stored.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-xs text-zinc-100">
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
        </pre>
        <p className="max-w-2xl text-sm text-zinc-500">
          A failed check comes back with the reason and what to look at, not just a no.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Get listed for the requests you don&apos;t sign</h2>
        <p className="max-w-2xl text-zinc-600">
          Fleets are rarely uniformly signed — a different service, a different HTTP client, a proxy that strips headers
          on retry. Listing your user agent in TrustTab&apos;s known-agent list means those requests read as your
          agent&apos;s name rather than &ldquo;unclassified&rdquo;.
        </p>
        <p className="max-w-2xl text-zinc-600">
          It is the weaker tier and the dashboard says so wherever it appears: a user agent is self-reported and
          trivially forged, so a match is an estimate. Signing is what makes it a fact.
        </p>
        <p className="max-w-2xl text-zinc-600">
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

      <section className="max-w-2xl space-y-3 border-t border-zinc-200 pt-8">
        <h2 className="text-lg font-semibold">What TrustTab does not do</h2>
        <p className="text-zinc-600">{AGENT_DISCLAIMER}</p>
        <p className="text-sm text-zinc-500">
          Related: <Link href="/for-security" className="underline underline-offset-4">what site owners see</Link>, and
          the <Link href="/" className="underline underline-offset-4">five stages</Link> this fits into.
        </p>
      </section>
    </div>
  );
}
