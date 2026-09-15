import { normalizeDomain } from "@/lib/domain";
import { recordHit } from "@/lib/hits";
import { getIssuer } from "@/lib/manifest/build";
import { enforceRateLimit } from "@/lib/rate-limit";
import { lookupRegistryEntryByDomain, REGISTRY_RESPONSE_HEADERS, registryEntryJson } from "@/lib/registry";

/**
 * GET /api/verify/by-domain/:domain — public registry lookup by domain.
 *
 * For clients that know which site they're on but not its `tt_…` ID, such as
 * the TrustTab browser extension. The domain is normalized the same way as
 * everywhere else (lowercase, punycode, no leading `www.`) and matched
 * exactly; a subdomain doesn't inherit its parent's entry.
 *
 *   200 same body as GET /api/verify/:verificationId
 *   400 { status: "invalid_domain" }
 *   404 { status: "not_found" }
 *
 * Same rate limit and traffic logging as the ID lookup.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/verify/by-domain/[domain]">) {
  const limited = await enforceRateLimit(request, "api", REGISTRY_RESPONSE_HEADERS);
  if (limited) return limited;

  const { domain: raw } = await ctx.params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return Response.json({ status: "invalid_domain" }, { status: 400, headers: REGISTRY_RESPONSE_HEADERS });
  }
  const normalized = normalizeDomain(decoded);
  if (!normalized.ok) {
    return Response.json({ status: "invalid_domain" }, { status: 400, headers: REGISTRY_RESPONSE_HEADERS });
  }

  const entry = await lookupRegistryEntryByDomain(normalized.domain);
  if (!entry) {
    return Response.json({ status: "not_found" }, { status: 404, headers: REGISTRY_RESPONSE_HEADERS });
  }

  recordHit(request, entry.siteId, "verify");
  return Response.json(registryEntryJson(entry, getIssuer()), { headers: REGISTRY_RESPONSE_HEADERS });
}
