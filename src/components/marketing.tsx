/**
 * Shared visual language for the three marketing pages.
 *
 * The house style was Day-1 minimal by design ("Visual polish is scheduled for
 * Day 4" — globals.css). This is that pass: tighter display type, a small
 * uppercase eyebrow above each section, roomier rhythm, and an alternating
 * light/dark cadence. No copy lives here — every string still comes from the
 * page or from `src/lib/landing/`, so the reviewed wording and the tests that
 * pin it are untouched.
 */

/** The small uppercase label above a section heading. */
export function Eyebrow({ children, tone = "light" }: { children: React.ReactNode; tone?: "light" | "dark" }) {
  return (
    <p
      className={`text-[11px] font-medium tracking-[0.18em] uppercase ${tone === "dark" ? "text-zinc-500" : "text-zinc-400"}`}
    >
      {children}
    </p>
  );
}

/** A section heading, with its eyebrow and an optional standfirst. */
export function SectionHeading({
  eyebrow,
  title,
  standfirst,
  align = "left",
  tone = "light",
}: {
  /** Only ever a string the page already had; nothing is invented for the device. */
  eyebrow?: string;
  title: string;
  standfirst?: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
}) {
  const centered = align === "center";
  return (
    <div className={`space-y-3 ${centered ? "mx-auto max-w-2xl text-center" : "max-w-3xl"}`}>
      {eyebrow && <Eyebrow tone={tone}>{eyebrow}</Eyebrow>}
      <h2
        className={`text-2xl font-semibold tracking-[-0.02em] sm:text-3xl ${tone === "dark" ? "text-white" : "text-zinc-900"}`}
      >
        {title}
      </h2>
      {standfirst && (
        <p className={`text-[15px] leading-relaxed ${tone === "dark" ? "text-zinc-400" : "text-zinc-600"}`}>
          {standfirst}
        </p>
      )}
    </div>
  );
}

/**
 * A dark inset panel. Used for the two places on the site that are set apart
 * from the product itself: what isn't built yet, and how the open-source code
 * relates to the one hosted registry.
 */
export function DarkPanel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-zinc-900 px-6 py-10 sm:px-10 sm:py-12 ${className}`}>{children}</section>;
}

/**
 * A card for one step in a sequence.
 *
 * The step's number stays inline in its own title, exactly as written. An
 * earlier version lifted it out into a separate numeral: it looked better, but
 * it was the one place on the site where the rendered text differed from the
 * reviewed copy, and the owner chose the copy.
 */
export function StepCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-6">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
    </div>
  );
}

/** A terminal-style block for a real command or response. */
export function Terminal({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-zinc-900">
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-xs leading-relaxed text-zinc-300">{children}</pre>
    </div>
  );
}
