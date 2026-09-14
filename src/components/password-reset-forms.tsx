"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

const inputClass = "w-full rounded-md border border-zinc-300 bg-white px-3 py-2";
const buttonClass =
  "w-full rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50";

/** Step 1: ask for a reset link. */
export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const email = String(new FormData(event.currentTarget).get("email"));
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many requests. Please wait a minute and try again."
          : (error.message ?? "Something went wrong."),
      );
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        {/* Same message whether or not the address has an account. */}
        <p className="text-zinc-700">
          If an account exists for <span className="font-medium break-all">{sentTo}</span>, we&apos;ve sent a link to
          reset its password. The link works once, for an hour.
        </p>
        <Link href="/login" className="text-sm underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-zinc-600">Enter your account&apos;s email and we&apos;ll send you a reset link.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Email</span>
          <input name="email" type="email" required autoComplete="email" className={inputClass} />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <Link href="/login" className="text-sm underline">
        Back to log in
      </Link>
    </div>
  );
}

/** Step 2: set the new password, using the token from the emailed link. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  // Remove the token from the address bar so it doesn't linger in history,
  // screenshots or copy-pasted URLs. It's kept in memory for the submit; if the
  // page is reloaded, re-opening the emailed link still works until it's used.
  useEffect(() => {
    window.history.replaceState(null, "", "/reset-password");
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError("The passwords don't match.");
      return;
    }
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setPending(false);
    if (error) {
      setError(
        error.code === "INVALID_TOKEN"
          ? "This reset link has expired or was already used. Request a new one."
          : (error.message ?? "Something went wrong."),
      );
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Password updated</h1>
        <p className="text-zinc-700">
          Your password has been changed and you&apos;ve been signed out everywhere. Log in with your new password.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <form onSubmit={onSubmit} className="space-y-4">
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
            {error}{" "}
            {error.includes("Request a new one") && (
              <Link href="/forgot-password" className="underline">
                Send a new link
              </Link>
            )}
          </p>
        )}
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Set new password"}
        </button>
      </form>
    </div>
  );
}
