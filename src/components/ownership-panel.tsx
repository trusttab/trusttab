"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusPill } from "./status-pill";

type Props = {
  siteId: string;
  domain: string;
  snippet: string;
  ownershipVerifiedAt: string | null;
};

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "failed"; message: string; checkedUrl?: string };

export function OwnershipPanel({ siteId, domain, snippet, ownershipVerifiedAt }: Props) {
  const router = useRouter();
  const [state, setState] = useState<CheckState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function checkNow() {
    setState({ kind: "checking" });
    try {
      const res = await fetch(`/api/sites/${siteId}/check-ownership`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.verified) {
        setState({ kind: "idle" });
        router.refresh(); // re-render the server page with the new timestamp
        return;
      }
      setState({
        kind: "failed",
        message: data.reason ?? data.error ?? `Check failed (HTTP ${res.status}).`,
        checkedUrl: data.checkedUrl,
      });
    } catch {
      setState({ kind: "failed", message: "Network error — please try again." });
    }
  }

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (ownershipVerifiedAt) {
    return (
      <section className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-center gap-2">
          <h2 className="font-medium">Domain ownership</h2>
          <StatusPill tone="good">Verified</StatusPill>
        </div>
        <p className="text-sm text-zinc-700">
          Verified on {new Date(ownershipVerifiedAt).toLocaleString()}. You can leave the meta tag in
          place — future re-verification may check it again.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Domain ownership</h2>
        <StatusPill tone="neutral">Not verified yet</StatusPill>
      </div>

      <ol className="list-decimal space-y-4 pl-5 text-sm text-zinc-700">
        <li className="space-y-2">
          <p>
            Add this tag inside the <code className="font-mono">&lt;head&gt;</code> of{" "}
            <code className="font-mono">https://{domain}/</code>:
          </p>
          <div className="flex items-stretch gap-2">
            <pre className="flex-1 overflow-x-auto rounded-md bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100">
              {snippet}
            </pre>
            <button
              type="button"
              onClick={copySnippet}
              className="rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </li>
        <li className="space-y-2">
          <p>Publish the change, then check:</p>
          <button
            type="button"
            onClick={checkNow}
            disabled={state.kind === "checking"}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {state.kind === "checking" ? "Checking…" : "Check now"}
          </button>
        </li>
      </ol>

      {state.kind === "failed" && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{state.message}</p>
          {state.checkedUrl && <p className="mt-1 text-xs text-red-600">Checked: {state.checkedUrl}</p>}
        </div>
      )}
    </section>
  );
}
