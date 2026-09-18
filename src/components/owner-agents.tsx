"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { OWNER_AGENT_HEADER, OWNER_AGENT_LIMIT, type OwnerAgent } from "@/lib/agent-traffic/owner-agents";

const MATCH_LABELS: Record<OwnerAgent["matchType"], string> = {
  user_agent: "User agent contains",
  ip: "IP address or range",
  header: `${OWNER_AGENT_HEADER} header equals`,
};

/**
 * Register agents the owner built themselves, so their traffic is labelled
 * instead of sitting in unclassified. This is the owner tagging their own
 * traffic, so it asks for a signal and takes their word for it — and says
 * plainly that it is their label, not a verification.
 */
export function OwnerAgents({ siteId, agents }: { siteId: string; agents: OwnerAgent[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [matchType, setMatchType] = useState<OwnerAgent["matchType"]>("user_agent");
  const [matchValue, setMatchValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/sites/${siteId}/owner-agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, matchType, matchValue }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Couldn't save that.");
        return;
      }
      setName("");
      setMatchValue("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/sites/${siteId}/owner-agents?agentId=${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Your own agents</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Built an agent yourself? Tell TrustTab how to recognise it and its traffic gets your name for it instead of sitting in
          unclassified. Agents built on no-code platforms usually match neither of the other two tiers: they publish no signing keys, and
          their addresses aren&apos;t in any published crawler range.
        </p>
      </div>

      {agents.length > 0 && (
        <ul className="divide-y divide-zinc-100 text-sm">
          {agents.map((agent) => (
            <li key={agent.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{agent.name}</span>
                <span className="ml-2 text-xs text-zinc-600">
                  {MATCH_LABELS[agent.matchType]} <code className="font-mono">{agent.matchValue}</code>
                </span>
              </span>
              <button type="button" onClick={() => remove(agent.id)} className="text-xs text-zinc-500 underline hover:text-zinc-800">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-zinc-600">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lead Follow-up Bot"
            className="mt-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block text-zinc-600">Recognise it by</span>
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value as OwnerAgent["matchType"])}
            className="mt-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
          >
            <option value="user_agent">User agent contains</option>
            <option value="ip">IP address or range</option>
            <option value="header">{OWNER_AGENT_HEADER} header</option>
          </select>
        </label>
        <label className="text-xs grow">
          <span className="block text-zinc-600">Value</span>
          <input
            value={matchValue}
            onChange={(e) => setMatchValue(e.target.value)}
            placeholder={matchType === "ip" ? "203.0.113.0/24" : matchType === "header" ? "lead-bot" : "MyCompanyBot"}
            className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-sm"
          />
        </label>
        <button type="submit" disabled={pending} className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-zinc-400 disabled:opacity-60">
          {pending ? "Saving…" : "Add agent"}
        </button>
      </form>

      {error && <p className="text-xs text-red-700">{error}</p>}
      <p className="text-xs text-zinc-500">{OWNER_AGENT_LIMIT}</p>
    </section>
  );
}
