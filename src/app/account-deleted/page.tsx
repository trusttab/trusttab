import Link from "next/link";

export const metadata = { title: "Account deleted — TrustTab" };

export default function AccountDeletedPage() {
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Your account has been deleted</h1>
      <p className="text-zinc-700">
        Your account, sites, manifests and verification history have been removed. Badges and public verification pages
        for your sites no longer resolve.
      </p>
      <Link href="/" className="text-sm underline">
        Back to TrustTab
      </Link>
    </div>
  );
}
