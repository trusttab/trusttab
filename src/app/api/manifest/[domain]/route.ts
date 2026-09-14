import { normalizeDomain } from "@/lib/domain";
import { recordHit } from "@/lib/hits";
import { getLiveManifestForDomain } from "@/lib/manifest/queries";
import { enforceRateLimit } from "@/lib/rate-limit";

const publicHeaders = {
  // Agents may fetch this from browsers on any origin.
  "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff",
};

/**
 * GET /api/manifest/:domain — public. Serves the live signed manifest for a
 * domain, exactly as signed. Site owners point
 * https://<domain>/.well-known/agent-trust.json here (by redirect or proxy).
 *
 * An expired manifest is still served: `site.expires_at` is part of the signed
 * document, and consumers must check it themselves.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/manifest/[domain]">) {
  const limited = await enforceRateLimit(request, "api", publicHeaders);
  if (limited) return limited;

  const { domain: rawDomain } = await ctx.params;
  const normalized = normalizeDomain(decodeURIComponent(rawDomain));
  if (!normalized.ok) {
    return Response.json({ error: "Invalid domain." }, { status: 400, headers: publicHeaders });
  }

  const manifest = await getLiveManifestForDomain(normalized.domain);
  if (!manifest) {
    return Response.json(
      { error: `No TrustTab manifest is published for ${normalized.domain}.` },
      { status: 404, headers: publicHeaders },
    );
  }

  recordHit(request, manifest.siteId, "manifest");

  return new Response(JSON.stringify(manifest.payloadJson, null, 2), {
    headers: {
      ...publicHeaders,
      "content-type": "application/json; charset=utf-8",
      // `private`: browsers may cache briefly, but shared caches and CDNs
      // (including Vercel's, which caches `public, max-age`) must not, so
      // every request reaches the function to be rate-limited and logged.
      // A re-published or re-verified manifest should show up fast anyway.
      "cache-control": "private, max-age=60",
      "x-trusttab-manifest-version": String(manifest.version),
    },
  });
}
