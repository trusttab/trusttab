import { ClaimDomainForm } from "@/components/claim-domain-form";
import { requireUser } from "@/lib/auth";
import { normalizeDomain } from "@/lib/domain";

export const metadata = { title: "Claim a domain — TrustTab" };

export default async function NewSitePage(props: PageProps<"/dashboard/new">) {
  await requireUser();
  const { domain } = await props.searchParams;
  const initialDomain = typeof domain === "string" ? normalizeDomain(domain) : null;
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Claim a domain</h1>
        <p className="text-zinc-600">
          Enter the domain you want to verify. Next you&apos;ll add a meta tag to its homepage to
          prove you control it.
        </p>
      </div>
      <ClaimDomainForm initialDomain={initialDomain?.ok ? initialDomain.domain : ""} />
    </div>
  );
}
