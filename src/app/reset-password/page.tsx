import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/password-reset-forms";

export const metadata: Metadata = {
  title: "Choose a new password — TrustTab",
  // The reset token arrives in this page's URL; never leak it via Referer.
  referrer: "no-referrer",
};

/**
 * Landing page for password reset links. Better Auth checks the link at
 * /api/auth/reset-password/:token and redirects here with `?token=...`, or
 * with `?error=INVALID_TOKEN` if it's unknown, expired or already used.
 */
export default async function ResetPasswordPage(props: PageProps<"/reset-password">) {
  const { token, error } = await props.searchParams;

  if (error || typeof token !== "string" || !token) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">This reset link doesn&apos;t work</h1>
        <p className="text-zinc-700">
          It may have expired, already been used, or been copied incompletely. Reset links work once, for an hour.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
        >
          Send a new link
        </Link>
      </div>
    );
  }

  return <ResetPasswordForm token={token} />;
}
