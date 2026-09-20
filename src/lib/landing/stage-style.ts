/**
 * How a stage is drawn, keyed off whether it is shipped.
 *
 * This exists because `stages.test.ts` can't catch the failure that matters
 * most during a visual pass. It pins that the data is partitioned and that the
 * page renders the two groups from separate arrays — but a restyle could render
 * five identical cards from two arrays and every one of those tests would still
 * pass. The distinction is a visual property, so it needs a visual assertion.
 *
 * Both treatments come from here, and `stage-style.test.ts` asserts they stay
 * materially different: a shipped stage is a card on the page's surface, an
 * unshipped one is set apart on dark ground with no card, no fill of its own
 * and nowhere to click. Change one side and the test tells you.
 */

export type StageTreatment = {
  /** The stage's outer container. */
  container: string;
  /** The stage name. */
  heading: string;
  /** The body copy. */
  body: string;
  /** The small caveat line under the body. */
  caveat: string;
  /** Whether this treatment draws a card: surface, border, the page's own ground. */
  isCard: boolean;
  /** Whether a call to action may appear. Only ever true for shipped work. */
  allowsCallToAction: boolean;
};

const SHIPPED: StageTreatment = {
  container:
    "flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-300",
  heading: "text-base font-semibold tracking-tight text-zinc-900",
  body: "mt-3 text-sm leading-relaxed text-zinc-600",
  caveat: "mt-3 text-xs leading-relaxed text-zinc-500",
  isCard: true,
  allowsCallToAction: true,
};

/**
 * Not a card, and not on the page's own ground: the reader should register
 * "this is a different kind of thing" before reading a word of it.
 */
const NOT_BUILT: StageTreatment = {
  container: "max-w-2xl border-l-2 border-dashed border-zinc-600 pl-6",
  heading: "text-base font-semibold tracking-tight text-zinc-100",
  body: "mt-3 text-sm leading-relaxed text-zinc-400",
  caveat: "mt-3 text-xs leading-relaxed text-zinc-500",
  isCard: false,
  allowsCallToAction: false,
};

export function stageTreatment(shipped: boolean): StageTreatment {
  return shipped ? SHIPPED : NOT_BUILT;
}
