import Link from "next/link";

import { DarkPanel, SectionHeading, StepCard } from "@/components/marketing";
import { stageTreatment } from "@/lib/landing/stage-style";
import { NEXT_STAGES, SHIPPED_STAGES, type Stage } from "@/lib/landing/stages";
import { VISION_AREAS, VISION_INTRO } from "@/lib/landing/vision";

/**
 * The landing page. Its one structural rule survives the restyle: shipped and
 * unshipped work never look alike. The four shipped stages are cards on the
 * page's own ground; Protection is set apart on dark, with no card, no fill and
 * nowhere to click.
 *
 * Both treatments come from `stageTreatment`, and `stage-style.test.ts` pins
 * that they stay materially different — the data-level tests in `stages.test.ts`
 * can't see a restyle that makes them look the same.
 */

function ShippedStage({ stage, index }: { stage: Stage; index: number }) {
  const treatment = stageTreatment(stage.shipped);
  return (
    <article className={treatment.container}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={treatment.heading}>{stage.name}</h3>
        <span className="font-mono text-xs tabular-nums text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-zinc-700">{stage.tagline}</p>
      <p className={treatment.body}>{stage.body}</p>
      {stage.caveat && <p className={treatment.caveat}>{stage.caveat}</p>}
      {treatment.allowsCallToAction && stage.href && (
        <p className="mt-auto pt-5">
          <Link
            href={stage.href.url}
            className="text-sm font-medium text-zinc-900 underline underline-offset-4 hover:text-zinc-600"
          >
            {stage.href.label} →
          </Link>
        </p>
      )}
    </article>
  );
}

export default function Home() {
  return (
    <div data-shell="wide" className="space-y-24 pb-8">
      <section className="space-y-6 pt-10 sm:pt-16">
        <h1 className="max-w-4xl text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">
          The trust layer for AI agents and the sites they visit.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-zinc-600">
          AI agents now browse, fill in forms, and act on people&apos;s behalf. Both sides are working blind: a person
          can&apos;t see what a page is doing to their agent, and a site can&apos;t tell which agent is knocking.
          TrustTab is building that layer in five stages — detection, verification, identity, authorization,
          protection.
        </p>
        <p className="max-w-2xl text-lg font-medium">Four of them work today. The fifth isn&apos;t built.</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/signup"
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            Get verified
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-100"
          >
            Log in
          </Link>
        </div>
      </section>

      <section className="space-y-8">
        <SectionHeading title="Available now" standfirst="Four stages you can use today" align="center" />
        <div className="grid gap-5 md:grid-cols-2">
          {SHIPPED_STAGES.map((stage, index) => (
            <ShippedStage key={stage.name} stage={stage} index={index} />
          ))}
        </div>
      </section>

      {/*
        Deliberately not a fifth card, and deliberately not on the page's own
        ground. A roadmap item that looks like the shipped ones is the overclaim
        this page exists to avoid.
      */}
      <DarkPanel>
        <div className="space-y-8">
          <SectionHeading title="What's next" tone="dark" />
          {NEXT_STAGES.map((stage) => {
            const treatment = stageTreatment(stage.shipped);
            return (
              <div key={stage.name} className={treatment.container}>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h3 className={treatment.heading}>{stage.name}</h3>
                  <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300 ring-1 ring-zinc-700">
                    {stage.tagline}
                  </span>
                </div>
                <p className={treatment.body}>{stage.body}</p>
                {stage.caveat && <p className={treatment.caveat}>{stage.caveat}</p>}
              </div>
            );
          })}

          {/*
            Further out than the fifth stage, and separated from it: these are
            different surfaces, not further steps in the same pipeline. Same
            rule applies — nothing here claims TrustTab does any of it.
          */}
          <div className="space-y-5 border-t border-zinc-800 pt-8">
            <div className="max-w-2xl space-y-3">
              <h3 className="text-base font-semibold tracking-tight text-zinc-100">Beyond the five stages</h3>
              <p className="text-sm leading-relaxed text-zinc-400">{VISION_INTRO}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              {VISION_AREAS.map((area) => (
                <div key={area.name} className="space-y-2">
                  <h4 className="text-sm font-medium text-zinc-300">{area.name}</h4>
                  <p className="text-sm leading-relaxed text-zinc-500">{area.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DarkPanel>

      <section className="grid gap-5 sm:grid-cols-2">
        {[
          {
            href: "/for-agents",
            audience: "Building an AI agent?",
            body: "Publish a key directory and sites running TrustTab recognise your agent by name instead of leaving it unclassified. Check your signing setup with one request, no account needed.",
          },
          {
            href: "/for-security",
            audience: "Running a site agents reach?",
            body: "See which agents arrive, what they requested and in what order, and whether it matched what they declared. Inbound visibility only — it doesn't govern the agents you deploy yourself.",
          },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
          >
            <h2 className="text-base font-semibold tracking-tight">{card.audience}</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-zinc-600">{card.body}</p>
            <p className="mt-4 text-sm font-medium underline underline-offset-4">Read more →</p>
          </Link>
        ))}
      </section>

      <section className="space-y-8">
        <SectionHeading title="Getting verified takes three steps" align="center" />
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
            <StepCard key={step.title} title={step.title} body={step.body} />
          ))}
        </div>
      </section>

      <DarkPanel>
        <div className="max-w-3xl">
          <p className="text-[15px] leading-relaxed text-zinc-300">
            TrustTab isn&apos;t an agent-identity or payments protocol. It complements efforts like Visa&apos;s Trusted
            Agent Protocol and Google&apos;s AP2, which verify the <em>agent</em>. TrustTab verifies the{" "}
            <em>site</em>: that its forms are what they claim to be, with no hidden content trying to manipulate the
            agent filling them in.
          </p>
        </div>
      </DarkPanel>
    </div>
  );
}
