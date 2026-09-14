import * as cheerio from "cheerio";

/** `rel` value a site uses to point at its manifest from the homepage. */
export const MANIFEST_LINK_REL = "agent-trust-manifest";

/**
 * Finds `<link rel="agent-trust-manifest" href="...">` in a document's
 * `<head>` and resolves the href against the page URL.
 *
 * This is the discovery fallback for sites that can't serve files at
 * /.well-known/ — many hosted site builders reserve that path. Like the
 * ownership meta tag, only `<head>` counts, so user-generated body content
 * can't point an agent at a different manifest. `rel` is a space-separated
 * token list, matched case-insensitively.
 *
 * Returns null when there is no such link or its href isn't a valid URL.
 */
export function findManifestLink(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const link = $("head link[rel][href]")
    .toArray()
    .find((el) =>
      ($(el).attr("rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .includes(MANIFEST_LINK_REL),
    );
  if (!link) return null;

  try {
    return new URL($(link).attr("href")!.trim(), pageUrl).href;
  } catch {
    return null;
  }
}
