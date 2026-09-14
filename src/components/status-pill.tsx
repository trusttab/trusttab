const tones = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
} as const;

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
