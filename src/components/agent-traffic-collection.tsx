"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { COLLECTION_DISCLOSURE } from "@/lib/agent-traffic/display";

/**
 * Opt-in control for site-wide agent traffic. Collection is off until the
 * owner turns it on here, after reading what it collects and for how long.
 * The collector token is shown once, right after enabling.
 */
export function AgentTrafficCollection({ siteId, enabled }: { siteId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "enable" | "disable") {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/sites/${siteId}/agent-traffic`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json().catch(() => null)) as { token?: string; error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "Something went wrong.");
        return;
      }
      setToken(body?.token ?? null);
      router.refresh();
    } catch {
      setError("Couldn't reach TrustTab. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Traffic to your own pages (optional)</h3>
          <p className="mt-1 text-xs text-zinc-600">
            {enabled
              ? "Collection is on. Your collector reports requests to your pages."
              : "Off. Turn this on to also see agent traffic to your site's own pages, which needs a small collector installed on your site."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => send(enabled ? "disable" : "enable")}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:border-zinc-400 disabled:opacity-60"
        >
          {pending ? "Saving…" : enabled ? "Turn off" : "Turn on collection"}
        </button>
      </div>

      {!enabled && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-600">
          {COLLECTION_DISCLOSURE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}

      {token && (
        <div className="space-y-2 rounded-md border border-zinc-300 bg-white p-3">
          <p className="text-xs font-medium">Your collector token — copy it now, it isn&apos;t shown again.</p>
          <code className="block overflow-x-auto rounded bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-100">{token}</code>
          <p className="text-xs text-zinc-600">
            Install a collector with it:{" "}
            <a className="underline" href="https://github.com/trusttab/trusttab/blob/main/collectors/README.md" target="_blank" rel="noreferrer">
              Cloudflare Worker or Node/Next.js instructions
            </a>
            . Turning collection off invalidates this token.
          </p>
        </div>
      )}

      {enabled && !token && (
        <p className="text-xs text-zinc-600">
          Lost the token? Turn collection off and on again to issue a new one.{" "}
          <a className="underline" href="https://github.com/trusttab/trusttab/blob/main/collectors/README.md" target="_blank" rel="noreferrer">
            Collector instructions
          </a>
          .
        </p>
      )}
    </div>
  );
}
