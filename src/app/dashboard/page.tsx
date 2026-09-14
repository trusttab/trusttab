import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { db } from "@/db";
import { sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Dashboard — TrustTab" };

export default async function DashboardPage() {
  const user = await requireUser();
  const mySites = await db
    .select()
    .from(sites)
    .where(eq(sites.userId, user.id))
    .orderBy(desc(sites.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your sites</h1>
        <Link
          href="/dashboard/new"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Claim a domain
        </Link>
      </div>

      {mySites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-600">
          You haven&apos;t claimed any domains yet.{" "}
          <Link href="/dashboard/new" className="underline">
            Claim your first one
          </Link>
          .
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {mySites.map((site) => (
            <li key={site.id}>
              <Link
                href={`/dashboard/${site.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50"
              >
                <span className="font-medium">{site.domain}</span>
                <span className="flex items-center gap-2">
                  <StatusPill tone={site.ownershipVerifiedAt ? "good" : "neutral"}>
                    {site.ownershipVerifiedAt ? "Ownership verified" : "Ownership unverified"}
                  </StatusPill>
                  <StatusPill tone="neutral">Status: {site.status}</StatusPill>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
