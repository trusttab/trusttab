import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { normalizeDomain } from "@/lib/domain";

/**
 * /dashboard/open?domain=example.com — where the browser extension's
 * "Open in TrustTab" link lands. Sends the signed-in owner to that site's
 * page, or anyone else to the claim form prefilled with the domain. Keeps the
 * extension free of login checks and extra permissions.
 */
export default async function OpenSitePage(props: PageProps<"/dashboard/open">) {
  const { domain } = await props.searchParams;
  const user = await requireUser(`/dashboard/open?domain=${encodeURIComponent(typeof domain === "string" ? domain : "")}`);
  const normalized = typeof domain === "string" ? normalizeDomain(domain) : null;
  if (!normalized?.ok) redirect("/dashboard");

  const [site] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.userId, user.id), eq(sites.domain, normalized.domain)));
  redirect(site ? `/dashboard/${site.id}` : `/dashboard/new?domain=${encodeURIComponent(normalized.domain)}`);
}
