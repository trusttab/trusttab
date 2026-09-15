"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { DEFAULT_NEXT_PATH } from "@/lib/next-path";

/** Shared email/password form for /login and /signup. */
export function AuthForm({
  mode,
  showForgotPassword = false,
  next = DEFAULT_NEXT_PATH,
}: {
  mode: "login" | "signup";
  /** Only when this deployment can send email; otherwise the reset flow is off. */
  showForgotPassword?: boolean;
  /** Already-validated path (safeNextPath) to go to after signing in. */
  next?: string;
}) {
  const nextQuery = next === DEFAULT_NEXT_PATH ? "" : `?next=${encodeURIComponent(next)}`;
  // Where links in verification emails land (see src/app/email-verified), carrying `next`.
  const verificationCallback = `/email-verified${nextQuery}`;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Set when the user must click the link we emailed before they can sign in. */
  const [checkInboxFor, setCheckInboxFor] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    if (mode === "signup") {
      const { data, error } = await authClient.signUp.email({
        email,
        password,
        name: email.split("@")[0], // Better Auth requires a display name; we don't ask for one yet.
        callbackURL: verificationCallback,
      });
      if (error) return fail(error.message);
      // No session token means email verification is required. (Better Auth
      // returns the same response for an already-registered email, so this
      // screen doesn't reveal which addresses have accounts.)
      if (!data?.token) {
        setCheckInboxFor(email);
        setPending(false);
        return;
      }
    } else {
      const { error } = await authClient.signIn.email({ email, password, callbackURL: verificationCallback });
      if (error?.code === "EMAIL_NOT_VERIFIED") {
        // Better Auth has just emailed a fresh verification link.
        setCheckInboxFor(email);
        setPending(false);
        return;
      }
      if (error) return fail(error.message);
    }

    router.push(next);
    router.refresh();
  }

  function fail(message: string | undefined) {
    setError(message ?? "Something went wrong. Please try again.");
    setPending(false);
  }

  const isSignup = mode === "signup";

  if (checkInboxFor) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="text-zinc-700">
          {isSignup ? "We've sent" : "Your email address isn't verified yet. We've sent"} a verification link to{" "}
          <span className="font-medium break-all">{checkInboxFor}</span>. Click it to{" "}
          {isSignup ? "finish creating your account" : "verify your address and sign in"}.
        </p>
        <p className="text-sm text-zinc-500">
          The link expires in an hour. Didn&apos;t get it? Check your spam folder, or{" "}
          <Link href={`/login${nextQuery}`} className="underline" onClick={() => setCheckInboxFor(null)}>
            log in
          </Link>{" "}
          again to get a new one.
        </p>
      </div>
    );
  }

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
        {showForgotPassword && (
          <p className="-mt-2 text-right text-sm">
            <Link href="/forgot-password" className="text-zinc-600 underline">
              Forgot password?
            </Link>
          </p>
        )}
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
            Already have an account? <Link href={`/login${nextQuery}`} className="underline">Log in</Link>
          </>
        ) : (
          <>
            New to TrustTab? <Link href={`/signup${nextQuery}`} className="underline">Create an account</Link>
          </>
        )}
      </p>
    </div>
  );
}
