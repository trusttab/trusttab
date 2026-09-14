import Link from "next/link";
import { redirect } from "next/navigation";

import { ForgotPasswordForm } from "@/components/password-reset-forms";
import { emailEnabled, getSession } from "@/lib/auth";

export const metadata = { title: "Forgot password — TrustTab" };

export default async function ForgotPasswordPage() {
  if (await getSession()) redirect("/dashboard");

  if (!emailEnabled) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Password reset unavailable</h1>
        <p className="text-zinc-700">
          This TrustTab instance can&apos;t send email yet, so passwords can&apos;t be reset online. Contact the
          operator of this instance for help.
        </p>
        <Link href="/login" className="text-sm underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return <ForgotPasswordForm />;
}
