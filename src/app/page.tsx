import Link from "next/link";

import { NEXT_STAGES, SHIPPED_STAGES, type Stage } from "@/lib/landing/stages";

/**
 * The landing page. Its one structural rule: shipped and unshipped work never
 * look alike. Shipped stages are cards with somewhere to go; the unshipped one
 * is not a card at all, so the difference survives a glance at the page rather
 * than depending on a reader noticing a label.
 *
 * The stages themselves, and which of them exist, live in
 * `src/lib/landing/stages.ts` and are pinned by its test.
 */

function ShippedStage({ stage, index }: { stage: Stage; index: number }) {
  return (
    <article className="flex flex-col rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-zinc-400 tabular-nums">{index + 1}</span>
        <h3 className="font-medium">{stage.name}</h3>
      </div>
      <p className="mt-1 text-sm font-medium text-zinc-700">{stage.tagline}</p>
      <p className="mt-3 text-sm text-zinc-600">{stage.body}</p>
      {stage.caveat && <p className="mt-3 text-xs text-zinc-500">{stage.caveat}</p>}
      {stage.href && (
        <p className="mt-4">
          <Link href={stage.href.url} className="text-sm font-medium underline underline-offset-4 hover:text-zinc-600">
            {stage.href.label} →
          </Link>
        </p>
      )}
    </article>
  );
}

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="space-y-5 pt-6">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          The trust layer for AI agents and the sites they visit.
        </h1>
        <p className="max-w-2xl text-lg text-zinc-600">
          AI agents now browse, fill in forms, and act on people&apos;s behalf. Both sides are working blind: a person
          can&apos;t see what a page is doing to their agent, and a site can&apos;t tell which agent is knocking.
          TrustTab is building that layer in five stages — detection, verification, identity, authorization,
          protection.
        </p>
        <p className="max-w-2xl font-medium">Four of them work today. The fifth isn&apos;t built.</p>
        <div className="flex gap-3 pt-1">
          <Link
            href="/signup"
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
          >
            Get verified
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 font-medium hover:bg-zinc-100"
          >
            Log in
          </Link>
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold">Available now</h2>
          <span className="text-sm text-zinc-500">Four stages you can use today</span>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {SHIPPED_STAGES.map((stage, index) => (
            <ShippedStage key={stage.name} stage={stage} index={index} />
          ))}
        </div>
      </section>

      {/*
        Deliberately not a fifth card: no fill, no border box, no link. A
        roadmap item that looks like the shipped ones is the overclaim this
        page exists to avoid.
      */}
      <section className="space-y-4 border-t border-zinc-200 pt-8">
        <h2 className="text-xl font-semibold text-zinc-500">What&apos;s next</h2>
        {NEXT_STAGES.map((stage) => (
          <div key={stage.name} className="max-w-2xl space-y-3 border-l-2 border-dashed border-zinc-300 pl-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="font-medium text-zinc-600">{stage.name}</h3>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">
                {stage.tagline}
              </span>
            </div>
            <p className="text-sm text-zinc-600">{stage.body}</p>
            {stage.caveat && <p className="text-xs text-zinc-500">{stage.caveat}</p>}
          </div>
        ))}
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold">Getting verified takes three steps</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              title: "1. Prove you own the domain",
              body: "Add one meta tag to your homepage. No DNS changes.",
            },
            {
              title: "2. Declare your agent-safe forms",
              body: "Publish a signed manifest at /.well-known/agent-trust.json.",
            },
            {
              title: "3. Get checked, get a badge",
              body: "We confirm your forms match the manifest and scan for hidden prompt injection.",
            },
          ].map((step) => (
            <div key={step.title} className="rounded-lg border border-zinc-200 bg-white p-5">
              <h3 className="font-medium">{step.title}</h3>
              <p className="mt-2 text-sm text-zinc-600">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="max-w-2xl text-sm text-zinc-500">
        TrustTab isn&apos;t an agent-identity or payments protocol. It complements efforts like Visa&apos;s Trusted
        Agent Protocol and Google&apos;s AP2, which verify the <em>agent</em>. TrustTab verifies the <em>site</em>:
        that its forms are what they claim to be, with no hidden content trying to manipulate the agent filling them
        in.
      </p>
    </div>
  );
}
