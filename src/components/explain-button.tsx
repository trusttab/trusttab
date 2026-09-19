"use client";

import { EXPLAIN_CHECKS_PROMPT, askAssistant } from "./explain-request";

/**
 * Sends the owner's question to the assistant panel further down the page. Only
 * rendered when the assistant is configured — the summary beside it stands on
 * its own without a model, which is the point of deriving it.
 */
export function ExplainButton({ label = "Explain this in plain English" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => askAssistant(EXPLAIN_CHECKS_PROMPT)}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50"
    >
      {label}
    </button>
  );
}
