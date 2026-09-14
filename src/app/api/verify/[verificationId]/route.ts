import { getIssuer } from "@/lib/manifest/build";
import { recordHit } from "@/lib/hits";
import { lookupRegistryEntry } from "@/lib/registry";

const publicHeaders = {
  "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff",
  // Browser-side cache only (no s-maxage), so every lookup reaches the
  // function and the traffic log stays complete.
  "cache-control": "public, max-age=60",
};

/**
 * GET /api/verify/:verificationId — public registry lookup.
 *
 * This is what gives a TrustTab badge meaning: anyone (an agent platform, a
 * visitor clicking a badge) can confirm with the issuer that a site's
 * verification is real and current.
 *
 *   200 { verification_id, status, domain, verified_at, expires_at, issuer, manifest_url }
 *   404 { status: "not_found" }
 *
 * `status` is one of verified | pending | needs_fix | failed | expired.
 * Only `verified` means the site currently passes every check.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/verify/[verificationId]">) {
  const { verificationId } = await ctx.params;
  const entry = await lookupRegistryEntry(verificationId);
  if (!entry) {
    return Response.json({ status: "not_found" }, { status: 404, headers: publicHeaders });
  }

  recordHit(request, entry.siteId, "verify");

  const issuer = getIssuer();
  return Response.json(
    {
      verification_id: entry.verificationId,
      status: entry.status,
      domain: entry.domain,
      verified_at: entry.verifiedAt?.toISOString() ?? null,
      expires_at: entry.expiresAt?.toISOString() ?? null,
      issuer: { name: issuer.name, url: issuer.url },
      manifest_url: `${issuer.url}/api/manifest/${entry.domain}`,
    },
    { headers: publicHeaders },
  );
}
