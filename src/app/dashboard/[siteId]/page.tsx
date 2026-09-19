import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AgentActivityPanel } from "@/components/agent-activity";
import { AgentTimelinePanel } from "@/components/agent-timeline";
import { AgentTraffic } from "@/components/agent-traffic";
import { OwnerAgents } from "@/components/owner-agents";
import { BadgeSnippet } from "@/components/badge-snippet";
import { OwnershipPanel } from "@/components/ownership-panel";
import { SiteSummaryPanel } from "@/components/site-summary";
import { SiteWorkspace } from "@/components/site-workspace";
import { PublishedManifest } from "@/components/published-manifest";
import { siteStatusLabel, siteStatusTone, StatusPill } from "@/components/status-pill";
import { TechnicalDetails } from "@/components/technical-details";
import { TrafficLog } from "@/components/traffic-log";
import { VerificationPanel } from "@/components/verification-panel";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getAssistantChanges, getOrCreateDraft } from "@/lib/drafts";
import { manifestToInput } from "@/lib/manifest/input";
import { ownerAgentsFor } from "@/lib/agent-traffic/collector";
import { getAgentActivity, getAgentTimeline, getAgentTraffic, getAgentVolume, getSiteAgentTraffic, parseRange, windowLabel } from "@/lib/agent-traffic/queries";
import { getLatestManifest, getLatestVerificationRun, getTraffic, isManifestExpired } from "@/lib/manifest/queries";
import { verificationSnippet } from "@/lib/ownership";
import { summarizeSite } from "@/lib/verification/summary";

export default async function SitePage(props: PageProps<"/dashboard/[siteId]">) {
  const { siteId } = await props.params;
  const user = await requireUser(`/dashboard/${encodeURIComponent(siteId)}`);
  if (!isUuid(siteId)) notFound();

  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)));
  if (!site) notFound();

  const search = await props.searchParams;
  const agentDays = parseRange(search.window);
  // Only the owner reaches this page (the query above scopes by user), so the
  // timeline and the owner's own agent labels are private by construction.
  const selectedAgent = typeof search.agent === "string" ? search.agent.slice(0, 200) : null;
  const [latest, lastRun, traffic, agentTraffic, siteAgentTraffic, agentActivity, agentVolume, agentTimeline, registeredAgents, draft, assistantChanges] =
    site.ownershipVerifiedAt
    ? await Promise.all([
        getLatestManifest(site.id),
        getLatestVerificationRun(site.id),
        getTraffic(site.id),
        getAgentTraffic(site.id, agentDays),
        site.agentTrafficEnabledAt ? getSiteAgentTraffic(site.id, agentDays) : Promise.resolve(null),
        site.agentTrafficEnabledAt ? getAgentActivity(site.id, agentDays) : Promise.resolve(null),
        site.agentTrafficEnabledAt ? getAgentVolume(site.id, agentDays) : Promise.resolve(null),
        site.agentTrafficEnabledAt && selectedAgent ? getAgentTimeline(site.id, selectedAgent, agentDays) : Promise.resolve([]),
        ownerAgentsFor(site.id),
        getOrCreateDraft(site.id),
        getAssistantChanges(site.id),
      ])
    : [undefined, undefined, undefined, undefined, null, null, null, [], [], undefined, []];
  const issuerUrl = process.env.TRUSTTAB_ISSUER_URL?.replace(/\/+$/, "") || null;

  const summary = summarizeSite({
    status: site.status,
    ownershipVerified: Boolean(site.ownershipVerifiedAt),
    hasManifest: Boolean(latest),
    expiresAt: latest?.expiresAt ?? null,
    lastRunAt: lastRun?.runAt ?? null,
    checks: lastRun?.resultsJson.checks ?? [],
  });
  // The section the owner's first task points at opens by default; everything
  // else starts closed.
  const primaryTarget = summary.actions[0]?.target ?? null;

  // One plain line about who has been requesting the site, for the summary.
  const identified = siteAgentTraffic
    ? siteAgentTraffic.totals.verified + siteAgentTraffic.totals.likely_automated + siteAgentTraffic.totals.owner_identified
    : 0;
  const agentLine = siteAgentTraffic
    ? identified > 0
      ? `${identified} request${identified === 1 ? "" : "s"} to your pages ${windowLabel(agentDays)} came from agents TrustTab could identify.`
      : `No agents TrustTab could identify requested your pages ${windowLabel(agentDays)}.`
    : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← All sites
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{site.domain}</h1>
          <StatusPill tone={siteStatusTone(site.status)}>{siteStatusLabel[site.status]}</StatusPill>
        </div>
      </div>

      <SiteSummaryPanel
        siteId={site.id}
        summary={summary}
        badgeUrl={site.verificationId && issuerUrl ? `/api/badge/${site.verificationId}.svg` : null}
        canRun={Boolean(site.ownershipVerifiedAt && latest)}
        assistantEnabled={Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(site.ownershipVerifiedAt)}
        agentLine={agentLine}
      />

      {!issuerUrl && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This TrustTab instance has no issuer configured (TRUSTTAB_ISSUER_NAME / TRUSTTAB_ISSUER_URL), so manifests
          can&apos;t be published yet.
        </p>
      )}

      {/* Ownership is the whole task until it's done, so it stays open until then. */}
      {site.ownershipVerifiedAt ? (
        <TechnicalDetails id="ownership" title="Domain ownership" note="How this site was claimed">
          <OwnershipPanel
            siteId={site.id}
            domain={site.domain}
            snippet={verificationSnippet(site.verificationToken)}
            ownershipVerifiedAt={site.ownershipVerifiedAt.toISOString()}
          />
        </TechnicalDetails>
      ) : (
        <div id="ownership">
          <OwnershipPanel
            siteId={site.id}
            domain={site.domain}
            snippet={verificationSnippet(site.verificationToken)}
            ownershipVerifiedAt={null}
          />
        </div>
      )}

      {site.ownershipVerifiedAt && (
        <>
          <TechnicalDetails
            id="checks"
            title="Verification checks"
            note="Every check, with what was found on each page"
            defaultOpen={primaryTarget === "checks"}
          >
            <VerificationPanel siteId={site.id} domain={site.domain} run={lastRun} canRun={Boolean(latest)} />
          </TechnicalDetails>

          {draft && (
            <TechnicalDetails
              id="forms"
              title="Your declared forms"
              note="Edit what you declare, and ask the assistant"
              defaultOpen={primaryTarget === "forms"}
            >
              <SiteWorkspace
                siteId={site.id}
                domain={site.domain}
                draft={{ input: draft.input, version: draft.version, hash: draft.hash }}
                published={latest ? manifestToInput(latest.payloadJson) : null}
                assistantChanges={assistantChanges.map((c) => ({ id: c.id, summary: c.summary, reason: c.reason }))}
                assistantEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
              />
            </TechnicalDetails>
          )}

          {latest && issuerUrl && (
            <TechnicalDetails
              id="manifest"
              title="Published document and how to serve it"
              note="The signed JSON, and the redirect or tag your site needs"
              defaultOpen={primaryTarget === "manifest"}
            >
              <PublishedManifest
                manifest={latest}
                domain={site.domain}
                issuerUrl={issuerUrl}
                expired={isManifestExpired(latest.expiresAt)}
              />
            </TechnicalDetails>
          )}
        </>
      )}

      {site.verificationId && issuerUrl && (
        <TechnicalDetails id="badge" title="Badge embed code" note="Paste this into your site">
          <BadgeSnippet issuerUrl={issuerUrl} verificationId={site.verificationId} />
        </TechnicalDetails>
      )}

      {agentTraffic && latest && (
        <TechnicalDetails
          id="agents"
          title="Agent traffic"
          note="Who has been requesting this site, and how that was established"
          // Opening an agent's timeline reloads the page, so keep the section
          // open when the owner is looking at one.
          defaultOpen={Boolean(selectedAgent) || typeof search.window === "string"}
        >
          <AgentTraffic
            siteId={site.id}
            summary={agentTraffic}
            siteSummary={siteAgentTraffic ?? null}
            collectionEnabled={site.agentTrafficEnabledAt !== null}
          />
          {agentActivity && <AgentActivityPanel agents={agentActivity} windowText={windowLabel(agentDays)} />}
          {agentVolume && (
            <AgentTimelinePanel siteId={site.id} range={agentDays} agents={agentVolume} selected={selectedAgent} requests={agentTimeline} />
          )}
          <OwnerAgents siteId={site.id} agents={registeredAgents} />
        </TechnicalDetails>
      )}

      {traffic && latest && (
        <TechnicalDetails id="logs" title="Request log" note="Raw requests to this site's public TrustTab endpoints">
          <TrafficLog hits={traffic.hits} counts={traffic.counts} />
        </TechnicalDetails>
      )}
    </div>
  );
}
