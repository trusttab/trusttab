"use client";

/**
 * Lets the plain-language summary at the top of a site page hand a question to
 * the assistant further down, without a second chat or a second model call
 * path: there is one conversation, reachable from two places.
 *
 * A DOM event rather than shared state, because the two components sit in
 * different parts of a server-rendered tree with no common client parent.
 */

const EVENT = "trusttab:ask-assistant";

/** The existing assistant capability this reuses, worded exactly as its own suggestion chip. */
export const EXPLAIN_CHECKS_PROMPT = "Explain my latest check results";

/** The id of the assistant section, so the summary can reveal and scroll to it. */
export const ASSISTANT_ANCHOR = "assistant";

export function askAssistant(prompt: string) {
  const panel = document.getElementById(ASSISTANT_ANCHOR);
  // The assistant may sit inside a closed "technical details" disclosure;
  // open every one above it before scrolling, or the scroll lands nowhere.
  for (let node = panel?.parentElement; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true;
  }
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.dispatchEvent(new CustomEvent(EVENT, { detail: prompt }));
}

export function onAskAssistant(handler: (prompt: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
