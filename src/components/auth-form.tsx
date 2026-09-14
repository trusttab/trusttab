"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

/** Shared email/password form for /login and /signup. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    const { error } =
      mode === "signup"
        ? // Better Auth requires a display name; we don't ask for one yet.
          await authClient.signUp.email({ email, password, name: email.split("@")[0] })
        : await authClient.signIn.email({ email, password });

    if (error) {
      setError(error.message ?? "Something went wrong. Please try again.");
      setPending(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  const isSignup = mode === "signup";

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isSignup ? "Create your TrustTab account" : "Log in to TrustTab"}
      </h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={isSignup ? 10 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
          />
          {isSignup && <span className="text-xs text-zinc-500">At least 10 characters.</span>}
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>
      <p className="text-sm text-zinc-600">
        {isSignup ? (
          <>
            Already have an account? <Link href="/login" className="underline">Log in</Link>
          </>
        ) : (
          <>
            New to TrustTab? <Link href="/signup" className="underline">Create an account</Link>
          </>
        )}
      </p>
    </div>
  );
}
