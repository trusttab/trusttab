"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ClaimDomainForm({ initialDomain = "" }: { initialDomain?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const domain = String(new FormData(event.currentTarget).get("domain"));
    const res = await fetch("/api/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error ?? "Could not claim that domain.");
      setPending(false);
      return;
    }
    router.push(`/dashboard/${data.site.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Domain</span>
        <input
          name="domain"
          defaultValue={initialDomain}
          required
          placeholder="example.com"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Claiming…" : "Continue"}
      </button>
    </form>
  );
}
