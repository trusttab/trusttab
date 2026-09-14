import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth";

export const metadata = { title: "Email verification — TrustTab" };

/** Better Auth's error codes for a verification link that didn't work. */
const errorMessages: Record<string, string> = {
  TOKEN_EXPIRED: "This verification link has expired.",
  INVALID_TOKEN: "This verification link isn't valid. It may have been copied incompletely.",
  USER_NOT_FOUND: "We couldn't find the account for this verification link.",
  INVALID_USER: "This link belongs to a different account than the one you're signed in to.",
};

/**
 * Landing page for links in verification emails. Better Auth verifies the
 * token at /api/auth/verify-email, signs the user in, and redirects here,
 * appending `?error=CODE` if verification failed.
 */
export default async function EmailVerifiedPage(props: PageProps<"/email-verified">) {
  const { error } = await props.searchParams;
  const code = typeof error === "string" ? error : undefined;

  if (!code) {
    if (await getSession()) redirect("/dashboard");
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Email verified</h1>
        <p className="text-zinc-700">Your email address is confirmed.</p>
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
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Couldn&apos;t verify your email</h1>
      <p className="text-zinc-700">{errorMessages[code] ?? "Something went wrong with this verification link."}</p>
      <p className="text-sm text-zinc-600">
        <Link href="/login" className="underline">
          Log in
        </Link>{" "}
        and we&apos;ll email you a new link.
      </p>
    </div>
  );
}
