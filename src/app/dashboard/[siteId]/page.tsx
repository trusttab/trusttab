import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ManifestEditor } from "@/components/manifest-editor";
import { OwnershipPanel } from "@/components/ownership-panel";
import { PublishedManifest } from "@/components/published-manifest";
import { siteStatusLabel, siteStatusTone, StatusPill } from "@/components/status-pill";
import { VerificationPanel } from "@/components/verification-panel";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getLatestManifest, getLatestVerificationRun, isManifestExpired } from "@/lib/manifest/queries";
import type { Manifest, ManifestInput } from "@/lib/manifest/types";
import { verificationSnippet } from "@/lib/ownership";

/** Extracts the owner-editable parts of a published manifest to prefill the editor. */
function toInput(manifest: Manifest): ManifestInput {
  return {
    no_prompt_injection_pledge: manifest.policy.no_prompt_injection_pledge,
    agent_rate_limit: manifest.policy.agent_rate_limit,
    endpoints: manifest.endpoints,
  };
}

export default async function SitePage(props: PageProps<"/dashboard/[siteId]">) {
  const user = await requireUser();
  const { siteId } = await props.params;
  if (!isUuid(siteId)) notFound();

  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)));
  if (!site) notFound();

  const [latest, lastRun] = site.ownershipVerifiedAt
    ? await Promise.all([getLatestManifest(site.id), getLatestVerificationRun(site.id)])
    : [undefined, undefined];
  const issuerUrl = process.env.TRUSTTAB_ISSUER_URL?.replace(/\/+$/, "") || null;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← All sites
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{site.domain}</h1>
          <StatusPill tone={siteStatusTone(site.status)}>{siteStatusLabel[site.status]}</StatusPill>
        </div>
      </div>

      <OwnershipPanel
        siteId={site.id}
        domain={site.domain}
        snippet={verificationSnippet(site.verificationToken)}
        ownershipVerifiedAt={site.ownershipVerifiedAt?.toISOString() ?? null}
      />

      {site.ownershipVerifiedAt ? (
        <>
          {latest && issuerUrl && (
            <PublishedManifest
              manifest={latest}
              domain={site.domain}
              issuerUrl={issuerUrl}
              expired={isManifestExpired(latest.expiresAt)}
            />
          )}
          <VerificationPanel siteId={site.id} domain={site.domain} run={lastRun} canRun={Boolean(latest)} />
          {!issuerUrl && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This TrustTab instance has no issuer configured (TRUSTTAB_ISSUER_NAME /
              TRUSTTAB_ISSUER_URL), so manifests can&apos;t be published yet.
            </p>
          )}
          <ManifestEditor siteId={site.id} initial={latest ? toInput(latest.payloadJson) : null} />
        </>
      ) : (
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-500">
          Verify ownership to start declaring your agent-ready forms.
        </section>
      )}

      {/* Placeholder so the shape of the finished page is visible. */}
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-500">
        Badge snippet and traffic log will appear here. (Coming in a later build day.)
      </section>
    </div>
  );
}
