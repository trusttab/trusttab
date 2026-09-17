import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentTraffic } from "@/components/agent-traffic";
import { BadgeSnippet } from "@/components/badge-snippet";
import { OwnershipPanel } from "@/components/ownership-panel";
import { SiteWorkspace } from "@/components/site-workspace";
import { PublishedManifest } from "@/components/published-manifest";
import { siteStatusLabel, siteStatusTone, StatusPill } from "@/components/status-pill";
import { TrafficLog } from "@/components/traffic-log";
import { VerificationPanel } from "@/components/verification-panel";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getAssistantChanges, getOrCreateDraft } from "@/lib/drafts";
import { manifestToInput } from "@/lib/manifest/input";
import { getAgentTraffic, getSiteAgentTraffic, parseRange } from "@/lib/agent-traffic/queries";
import { getLatestManifest, getLatestVerificationRun, getTraffic, isManifestExpired } from "@/lib/manifest/queries";
import { verificationSnippet } from "@/lib/ownership";

export default async function SitePage(props: PageProps<"/dashboard/[siteId]">) {
  const { siteId } = await props.params;
  const user = await requireUser(`/dashboard/${encodeURIComponent(siteId)}`);
  if (!isUuid(siteId)) notFound();

  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)));
  if (!site) notFound();

  const agentDays = parseRange((await props.searchParams).agentDays);
  const [latest, lastRun, traffic, agentTraffic, siteAgentTraffic, draft, assistantChanges] = site.ownershipVerifiedAt
    ? await Promise.all([
        getLatestManifest(site.id),
        getLatestVerificationRun(site.id),
        getTraffic(site.id),
        getAgentTraffic(site.id, agentDays),
        site.agentTrafficEnabledAt ? getSiteAgentTraffic(site.id, agentDays) : Promise.resolve(null),
        getOrCreateDraft(site.id),
        getAssistantChanges(site.id),
      ])
    : [undefined, undefined, undefined, undefined, null, undefined, []];
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
          {draft && (
            <SiteWorkspace
              siteId={site.id}
              domain={site.domain}
              draft={{ input: draft.input, version: draft.version, hash: draft.hash }}
              published={latest ? manifestToInput(latest.payloadJson) : null}
              assistantChanges={assistantChanges.map((c) => ({ id: c.id, summary: c.summary, reason: c.reason }))}
              assistantEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
            />
          )}
        </>
      ) : (
        <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-500">
          Verify ownership to start declaring your agent-ready forms.
        </section>
      )}

      {site.verificationId && issuerUrl && (
        <BadgeSnippet issuerUrl={issuerUrl} verificationId={site.verificationId} />
      )}
      {agentTraffic && latest && (
        <AgentTraffic
          siteId={site.id}
          summary={agentTraffic}
          siteSummary={siteAgentTraffic ?? null}
          collectionEnabled={site.agentTrafficEnabledAt !== null}
        />
      )}
      {traffic && latest && <TrafficLog hits={traffic.hits} counts={traffic.counts} />}
    </div>
  );
}
