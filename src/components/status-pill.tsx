const tones = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
} as const;

/** Pill tone for a `sites.status` value. */
export function siteStatusTone(status: string): keyof typeof tones {
  if (status === "verified") return "good";
  if (status === "self_declared") return "info";
  if (status === "failed" || status === "needs_fix") return "bad";
  return "neutral";
}

export const siteStatusLabel: Record<string, string> = {
  pending: "Not verified yet",
  verified: "Verified",
  self_declared: "Self-declared",
  needs_fix: "Needs fixes",
  failed: "Failed",
};

export function StatusPill({
  tone,
  children,
}: {
  tone: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}
