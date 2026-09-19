"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ASSISTANT_ANCHOR, EXPLAIN_CHECKS_PROMPT, onAskAssistant } from "./explain-request";

type ToolStep = { name: string; status: "started" | "done" | "error"; summary?: string };
type ClaimProposal = { domain: string; reason: string; state: "pending" | "claiming" | "claimed" | "dismissed"; siteId?: string; error?: string };

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; steps: ToolStep[]; claims: ClaimProposal[]; error?: string };

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; status: "started" | "done" | "error"; summary?: string }
  | { type: "draft_changed"; version: number; summary: string }
  | { type: "claim_proposal"; domain: string; reason: string }
  | { type: "error"; message: string }
  | { type: "done" };

const TOOL_LABELS: Record<string, string> = {
  get_site_overview: "Reading your site's status",
  crawl_site_forms: "Looking at your site's forms",
  add_endpoint: "Adding an endpoint to the draft",
  update_endpoint: "Updating the draft",
  remove_endpoint: "Removing an endpoint from the draft",
  set_rate_limit: "Updating the rate limit",
  preview_checks: "Previewing the checks",
  propose_domain_claim: "Preparing a domain claim",
};

const SUGGESTIONS = [
  "Draft my manifest from my site's forms",
  EXPLAIN_CHECKS_PROMPT,
  "Preview the checks for my draft",
];

type Props = {
  siteId: string;
  domain: string;
  /** Called before sending, to save the editor's pending edits. Resolves false to abort. */
  beforeSend: () => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
  /** Called after a reply in which the assistant changed the draft. */
  onDraftChanged: () => void;
};

/**
 * Per-site chat with the dashboard assistant. It can read, draft and preview,
 * but every change lands in the manifest editor for the owner to review, and
 * only the owner can sign and publish.
 */
export function AssistantPanel({ siteId, domain, beforeSend, onBusyChange, onDraftChanged }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const setBusyState = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };

  const updateLast = (fn: (m: Extract<Message, { role: "assistant" }>) => Extract<Message, { role: "assistant" }>) =>
    setMessages((list) => {
      const last = list[list.length - 1];
      if (!last || last.role !== "assistant") return list;
      return [...list.slice(0, -1), fn(last)];
    });

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    if (!(await beforeSend())) {
      setMessages((list) => [
        ...list,
        { role: "assistant", content: "", steps: [], claims: [], error: "Save or fix your draft edits first, then ask again." },
      ]);
      return;
    }

    const history = [...messages, { role: "user" as const, content }]
      .filter((m) => m.role === "user" || m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((list) => [...list, { role: "user", content }, { role: "assistant", content: "", steps: [], claims: [] }]);
    setInput("");
    setBusyState(true);
    let draftChanged = false;

    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch(`/api/sites/${siteId}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        updateLast((m) => ({ ...m, error: data.error ?? `The assistant is unavailable (HTTP ${res.status}).` }));
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          if (event.type === "text") updateLast((m) => ({ ...m, content: m.content + event.text }));
          else if (event.type === "tool") {
            updateLast((m) => {
              const steps = [...m.steps];
              const open = steps.findLastIndex((s) => s.name === event.name && s.status === "started");
              if (event.status !== "started" && open >= 0) steps[open] = event;
              else steps.push(event);
              return { ...m, steps };
            });
          } else if (event.type === "draft_changed") draftChanged = true;
          else if (event.type === "claim_proposal") {
            updateLast((m) => ({ ...m, claims: [...m.claims, { domain: event.domain, reason: event.reason, state: "pending" }] }));
          } else if (event.type === "error") updateLast((m) => ({ ...m, error: event.message }));
        }
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
      }
    } catch {
      if (!controller.signal.aborted) updateLast((m) => ({ ...m, error: "Lost connection to the assistant." }));
    } finally {
      abort.current = null;
      setBusyState(false);
      if (draftChanged) onDraftChanged();
    }
  }

  // The plain-language summary at the top of the page hands its "explain this"
  // question here rather than opening a second chat. `send` closes over the
  // conversation so far, so the listener goes through a ref kept up to date.
  const latestSend = useRef(send);
  useEffect(() => {
    latestSend.current = send;
  });
  useEffect(() => onAskAssistant((prompt) => void latestSend.current(prompt)), []);

  /** The owner's click is what claims the domain; the assistant only proposed it. */
  async function claim(messageIndex: number, domainToClaim: string) {
    const setClaim = (patch: Partial<ClaimProposal>) =>
      setMessages((list) =>
        list.map((m, i) =>
          i === messageIndex && m.role === "assistant"
            ? { ...m, claims: m.claims.map((c) => (c.domain === domainToClaim ? { ...c, ...patch } : c)) }
            : m,
        ),
      );
    setClaim({ state: "claiming", error: undefined });
    const res = await fetch("/api/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: domainToClaim }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setClaim({ state: "pending", error: data.error ?? "Couldn't claim that domain." });
    else setClaim({ state: "claimed", siteId: data.site.id });
  }

  return (
    <section id={ASSISTANT_ANCHOR} className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Assistant</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Ask it to draft your manifest from {domain}&apos;s forms, explain check results, or adjust settings. Its changes
          appear in the editor below. It can&apos;t publish; only you can.
        </p>
      </div>

      {messages.length > 0 && (
        <div ref={scroller} className="max-h-96 space-y-3 overflow-y-auto rounded-md bg-zinc-50 p-3 text-sm">
          {messages.map((m, i) =>
            m.role === "user" ? (
              <p key={i} className="ml-auto max-w-[85%] rounded-lg bg-zinc-900 px-3 py-2 whitespace-pre-wrap text-white">
                {m.content}
              </p>
            ) : (
              <div key={i} className="max-w-[95%] space-y-2">
                {m.steps.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-zinc-500">
                    {m.steps.map((s, j) => (
                      <li key={j}>
                        {s.status === "started" ? "…" : s.status === "done" ? "✓" : "✗"} {TOOL_LABELS[s.name] ?? s.name}
                        {s.summary && <span className="text-zinc-400">: {s.summary}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {m.content && <p className="rounded-lg bg-white px-3 py-2 whitespace-pre-wrap text-zinc-800 ring-1 ring-zinc-200">{m.content}</p>}
                {m.claims.map((c) => (
                  <div key={c.domain} className="space-y-2 rounded-md border border-zinc-300 bg-white p-3">
                    <p>
                      Claim <span className="font-mono font-medium">{c.domain}</span>?{" "}
                      <span className="text-zinc-600">{c.reason}</span>
                    </p>
                    {c.state === "claimed" ? (
                      <p className="text-emerald-800">
                        Claimed.{" "}
                        <Link href={`/dashboard/${c.siteId}`} className="underline">
                          Open {c.domain} to verify ownership
                        </Link>
                      </p>
                    ) : c.state === "dismissed" ? (
                      <p className="text-zinc-500">Not claimed.</p>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={c.state === "claiming"}
                          onClick={() => claim(i, c.domain)}
                          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {c.state === "claiming" ? "Claiming…" : "Claim this domain"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMessages((list) =>
                              list.map((x, k) =>
                                k === i && x.role === "assistant"
                                  ? { ...x, claims: x.claims.map((y) => (y.domain === c.domain ? { ...y, state: "dismissed" } : y)) }
                                  : x,
                              ),
                            )
                          }
                          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs"
                        >
                          No thanks
                        </button>
                      </div>
                    )}
                    {c.error && <p className="text-xs text-red-700">{c.error}</p>}
                  </div>
                ))}
                {m.error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{m.error}</p>}
                {busy && i === messages.length - 1 && !m.content && m.steps.length === 0 && (
                  <p className="text-xs text-zinc-500">Thinking…</p>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the assistant…"
          maxLength={4000}
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()} className="rounded-md border border-zinc-300 px-3 py-2 text-sm">
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            Send
          </button>
        )}
      </form>
    </section>
  );
}
