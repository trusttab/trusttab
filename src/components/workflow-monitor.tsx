"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CADENCES, WORKFLOW_CADENCE_LIMIT, WORKFLOW_NO_ALERTS, type CadenceId } from "@/lib/workflows/health";

/**
 * Adding a workflow, and the one-time ping URL.
 *
 * The URL is shown once and never again — only its hash is stored. The copy
 * says so at the moment it matters, rather than leaving the owner to find out
 * by reloading.
 */
export function AddWorkflow() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState<CadenceId>("1h");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; url: string } | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, cadence }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "Couldn't add that workflow.");
        return;
      }
      setIssued({ name, url: `${location.origin}/api/workflows/ping/${data.token}` });
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="font-medium">Monitor a workflow</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Add one HTTP request step to your workflow, pointing at the URL this gives you. It works on any platform that
          can make an HTTP call.
        </p>
      </div>

      {issued ? (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            Ping URL for “{issued.name}” — copy it now, it isn&apos;t shown again
          </p>
          <code className="block overflow-x-auto rounded bg-white px-2 py-1.5 font-mono text-xs break-all">
            {issued.url}
          </code>
          <p className="text-xs text-emerald-900">
            Only a hash of this is stored, so TrustTab can&apos;t show it to you later. Anyone who has it can make this
            workflow look alive, so treat it like a password. Lost it? Delete the workflow and add it again.
          </p>
          <button type="button" onClick={() => setIssued(null)} className="text-xs underline">
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs text-zinc-600">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nightly lead sync"
              className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-zinc-600">
            Should run
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as CadenceId)}
              className="mt-1 block rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
            >
              {CADENCES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={add}
            disabled={busy || name.trim().length < 2}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add workflow"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-amber-800">{error}</p>}
      <p className="text-xs text-zinc-500">{WORKFLOW_CADENCE_LIMIT}</p>
      <p className="text-xs text-zinc-500">{WORKFLOW_NO_ALERTS}</p>
    </section>
  );
}

export function DeleteWorkflow({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Stop monitoring “${name}”? Its ping URL stops working.`)) return;
        setBusy(true);
        await fetch("/api/workflows", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        }).catch(() => {});
        setBusy(false);
        router.refresh();
      }}
      className="text-xs text-zinc-500 underline hover:text-zinc-700"
    >
      {busy ? "Removing…" : "Remove"}
    </button>
  );
}
