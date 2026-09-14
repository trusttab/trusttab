import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OwnershipPanel } from "@/components/ownership-panel";
import { StatusPill } from "@/components/status-pill";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { verificationSnippet } from "@/lib/ownership";

export default async function SitePage(props: PageProps<"/dashboard/[siteId]">) {
  const user = await requireUser();
  const { siteId } = await props.params;
  if (!isUuid(siteId)) notFound();

  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.userId, user.id)));
  if (!site) notFound();

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-zinc-500 hover:underline">
          ← All sites
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{site.domain}</h1>
          <StatusPill tone="neutral">Status: {site.status}</StatusPill>
        </div>
      </div>

      <OwnershipPanel
        siteId={site.id}
        domain={site.domain}
        snippet={verificationSnippet(site.verificationToken)}
        ownershipVerifiedAt={site.ownershipVerifiedAt?.toISOString() ?? null}
      />

      {/* Placeholders so the shape of the finished page is visible. */}
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-500">
        Manifest editor, endpoint checks, badge snippet and traffic log will appear here once
        ownership is verified. (Coming in later build days.)
      </section>
    </div>
  );
}
