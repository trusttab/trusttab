"use client";

import { useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";

const inputClass = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2";

/** Change password for a signed-in user. Always signs out other sessions. */
export function ChangePasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("current"));
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) return setError("The new passwords don't match.");
    if (newPassword === currentPassword) return setError("Choose a password different from your current one.");

    setPending(true);
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setPending(false);

    if (error) {
      setError(
        error.code === "INVALID_PASSWORD"
          ? "Your current password is incorrect."
          : error.status === 429
            ? "Too many attempts. Please wait a few seconds and try again."
            : (error.message ?? "Something went wrong."),
      );
      return;
    }
    formRef.current?.reset();
    setSuccess(true);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Current password</span>
        <input name="current" type="password" required autoComplete="current-password" className={inputClass} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
        <span className="text-xs text-zinc-500">At least 10 characters.</span>
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Confirm new password</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Password changed. Your other devices have been signed out.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
