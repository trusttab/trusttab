import Link from "next/link";

import { ChangePasswordForm } from "@/components/change-password-form";
import { emailEnabled, requireUser } from "@/lib/auth";

export const metadata = { title: "Account — TrustTab" };

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← All sites
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-zinc-600">
          Signed in as <span className="font-medium break-all">{user.email}</span>
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5">
        <div>
          <h2 className="font-medium">Change password</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Changing your password signs you out on all your other devices
            {emailEnabled ? ", and we'll email you to confirm the change" : ""}.
          </p>
        </div>
        <ChangePasswordForm />
        {emailEnabled && (
          <p className="text-sm text-zinc-500">
            Don&apos;t know your current password? Sign out and use &quot;Forgot password?&quot; on the login page.
          </p>
        )}
      </section>
    </div>
  );
}
