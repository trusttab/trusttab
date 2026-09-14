import { renderBadge } from "@/lib/badge";
import { getIssuer } from "@/lib/manifest/build";
import { lookupRegistryEntry } from "@/lib/registry";

/**
 * GET /api/badge/:verificationId.svg — public, live status badge.
 *
 * Keyed by the public `tt_…` verification ID (not the internal site UUID) so
 * the badge, the registry lookup and the manifest all share one identifier.
 * Badge loads are not written to the traffic log: they happen on every page
 * view of the embedding site and would drown out agent traffic.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/badge/[file]">) {
  const { file } = await ctx.params;
  const match = /^(tt_[a-z0-9]{8,32})\.svg$/.exec(file);
  const entry = match ? await lookupRegistryEntry(match[1]) : null;

  return new Response(renderBadge(getIssuer().name, entry?.status ?? "not_found"), {
    status: entry ? 200 : 404,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // The badge must reflect live status, so caches revalidate every time.
      "cache-control": "no-cache, max-age=0",
      "x-content-type-options": "nosniff",
      // Opened directly, the SVG can't run scripts or load anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "access-control-allow-origin": "*",
    },
  });
}
