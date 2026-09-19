/**
 * A disclosure for the parts of the dashboard written in the language of the
 * protocol rather than the language of a business owner: check output, the
 * signed document itself, redirect configuration, request logs.
 *
 * None of it is removed or summarised away — the transparency is the product.
 * It is just no longer the first thing on the page. Native <details> so it
 * needs no client JavaScript, deep links (#checks) still work, and the browser's
 * own find-in-page can open it.
 */
export function TechnicalDetails({
  id,
  title,
  note,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  /** One line about what is inside, shown on the closed summary row. */
  note?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} className="group rounded-lg border border-zinc-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 hover:bg-zinc-50">
        <span>
          <span className="text-sm font-medium">{title}</span>
          {note && <span className="ml-2 text-xs text-zinc-500">{note}</span>}
        </span>
        <span className="text-xs text-zinc-400 group-open:hidden">Show</span>
        <span className="hidden text-xs text-zinc-400 group-open:inline">Hide</span>
      </summary>
      <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/60 px-4 py-4">{children}</div>
    </details>
  );
}
