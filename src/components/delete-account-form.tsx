"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

type Props = {
  email: string;
  /** Every domain the account has claimed. */
  domains: string[];
  /** Domains with a published registry entry whose badge and public page will stop resolving. */
  publicDomains: string[];
};

/** Irreversible account deletion, confirmed by typing the email and entering the password. */
export function DeleteAccountForm({ email, domains, publicDomains }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const confirmed = typedEmail.trim().toLowerCase() === email.toLowerCase();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setError(null);
    setPending(true);
    const password = String(new FormData(event.currentTarget).get("password"));
    const { error } = await authClient.deleteUser({ password });
    if (error) {
      setPending(false);
      setError(
        error.code === "INVALID_PASSWORD"
          ? "That password is incorrect."
          : error.status === 429
            ? "Too many attempts. Please wait a few seconds and try again."
            : (error.message ?? "Something went wrong."),
      );
      return;
    }
    // The session cookie is gone; refresh so the header re-renders signed out.
    router.push("/account-deleted");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete account…
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-900">
        <p className="font-medium">This permanently deletes, and can&apos;t be undone:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>your account and sign-in</li>
          <li>
            {domains.length === 0
              ? "(you have no claimed sites)"
              : `${domains.length} claimed site${domains.length === 1 ? "" : "s"} (${domains.join(", ")}), with their manifests, verification history and traffic logs`}
          </li>
          {publicDomains.length > 0 && (
            <li>
              the public manifests, badges and verification pages for {publicDomains.join(", ")}. Anyone checking them
              will see &quot;not found&quot;, and the domains can be claimed by another account.
            </li>
          )}
        </ul>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">
          Type your email, <span className="font-mono break-all">{email}</span>, to confirm
        </span>
        <input
          value={typedEmail}
          onChange={(e) => setTypedEmail(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={!confirmed || pending}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Permanently delete my account"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTypedEmail("");
            setError(null);
          }}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
