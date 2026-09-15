import { getIssuer } from "@/lib/manifest/build";
import { recordHit } from "@/lib/hits";
import { enforceRateLimit } from "@/lib/rate-limit";
import { lookupRegistryEntry, REGISTRY_RESPONSE_HEADERS, registryEntryJson } from "@/lib/registry";

const publicHeaders = REGISTRY_RESPONSE_HEADERS;

/**
 * GET /api/verify/:verificationId — public registry lookup.
 *
 * This is what gives a TrustTab badge meaning: anyone (an agent platform, a
 * visitor clicking a badge) can confirm with the issuer that a site's
 * verification is real and current.
 *
 *   200 { verification_id, status, domain, verified_at, expires_at, issuer,
 *         manifest_url, self_declared_endpoints }
 *   404 { status: "not_found" }
 *
 * `status` is one of verified | self_declared | pending | needs_fix | failed |
 * expired. Only `verified` means TrustTab confirmed everything. `self_declared`
 * means every automated check passed except the forms listed in
 * `self_declared_endpoints`, which only the site owner vouches for.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/verify/[verificationId]">) {
  const limited = await enforceRateLimit(request, "api", publicHeaders);
  if (limited) return limited;

  const { verificationId } = await ctx.params;
  const entry = await lookupRegistryEntry(verificationId);
  if (!entry) {
    return Response.json({ status: "not_found" }, { status: 404, headers: publicHeaders });
  }

  recordHit(request, entry.siteId, "verify");

  return Response.json(registryEntryJson(entry, getIssuer()), { headers: publicHeaders });
}
