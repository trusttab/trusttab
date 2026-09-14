import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { siteStatusTone, StatusPill } from "@/components/status-pill";
import { getIssuer } from "@/lib/manifest/build";
import { lookupRegistryEntry, type PublicStatus } from "@/lib/registry";

const explanations: Record<PublicStatus, string> = {
  verified: "passes every TrustTab check: its declared forms exist as described, no hidden prompt-injection content was found, and its manifest is signed and served for this domain.",
  self_declared:
    "passes TrustTab's automated checks for its domain, HTTPS and hidden prompt-injection content. However, some of its forms could not be checked automatically; the site owner declares they exist as described, and TrustTab has not confirmed them.",
  pending: "has published a manifest that hasn't passed verification yet.",
  needs_fix: "was checked recently and some checks did not pass.",
  failed: "was checked recently and content that could manipulate AI agents was found.",
  expired: "was verified, but its verification has expired and hasn't been renewed.",
};

const labels: Record<PublicStatus, string> = {
  verified: "Verified",
  self_declared: "Self-declared",
  pending: "Not verified yet",
  needs_fix: "Not verified",
  failed: "Failed",
  expired: "Expired",
};

export async function generateMetadata(props: PageProps<"/verify/[verificationId]">): Promise<Metadata> {
  const { verificationId } = await props.params;
  const entry = await lookupRegistryEntry(verificationId);
  return { title: entry ? `${entry.domain} — TrustTab verification` : "Verification not found — TrustTab" };
}

/** Public page a badge links to: a human-readable view of /api/verify/:id. */
export default async function PublicVerificationPage(props: PageProps<"/verify/[verificationId]">) {
  const { verificationId } = await props.params;
  const entry = await lookupRegistryEntry(verificationId);
  if (!entry) notFound();

  const issuer = getIssuer();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold break-all">{entry.domain}</h1>
          <StatusPill tone={siteStatusTone(entry.status === "expired" ? "pending" : entry.status)}>
            {labels[entry.status]}
          </StatusPill>
        </div>
        <p className="text-zinc-700">
          {entry.domain} {explanations[entry.status]}
        </p>
        {entry.status === "self_declared" && entry.selfDeclaredEndpoints.length > 0 && (
          <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
            <p className="font-medium">Forms declared by the owner, not confirmed by TrustTab:</p>
            <ul className="mt-1 list-disc pl-5 font-mono text-xs">
              {entry.selfDeclaredEndpoints.map((e) => (
                <li key={`${e.method} ${e.path}`}>
                  {e.method} {e.path} ({e.purpose})
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">Verified</dt>
          <dd>{entry.verifiedAt ? entry.verifiedAt.toUTCString() : "—"}</dd>
          <dt className="text-zinc-500">Valid until</dt>
          <dd>
            {(entry.status === "verified" || entry.status === "self_declared") && entry.expiresAt
              ? entry.expiresAt.toUTCString()
              : "—"}
          </dd>
          <dt className="text-zinc-500">Registry ID</dt>
          <dd className="font-mono">{entry.verificationId}</dd>
          <dt className="text-zinc-500">Issuer</dt>
          <dd>
            {issuer.name} ({issuer.url})
          </dd>
        </dl>
      </div>
      <p className="text-sm text-zinc-600">
        Machine-readable:{" "}
        <a className="font-mono underline" href={`/api/verify/${entry.verificationId}`}>
          /api/verify/{entry.verificationId}
        </a>{" "}
        ·{" "}
        <a className="font-mono underline" href={`/api/manifest/${entry.domain}`}>
          manifest
        </a>
      </p>
      <p className="text-sm text-zinc-500">
        A badge is only meaningful if this page is on the issuer you trust. Check the address bar.{" "}
        <Link href="/" className="underline">
          What is TrustTab?
        </Link>
      </p>
    </div>
  );
}
