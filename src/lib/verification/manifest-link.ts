import * as cheerio from "cheerio";

/**
 * Name used by both homepage pointer forms:
 *   <link rel="agent-trust-manifest" href="...">
 *   <meta name="agent-trust-manifest" content="...">
 */
export const MANIFEST_LINK_REL = "agent-trust-manifest";

/**
 * Finds a pointer to the site's manifest in a document's `<head>` and
 * resolves it against the page URL.
 *
 * This is the discovery fallback for sites that can't serve files at
 * /.well-known/ — many hosted site builders reserve that path. Two
 * equivalent forms are accepted, because builders differ in which custom
 * head tags they preserve (Base44, for one, keeps custom `<meta>` tags but
 * not custom `<link>` tags):
 *
 * - `<link rel="agent-trust-manifest" href="...">` (`rel` is a
 *   case-insensitive token list), checked first;
 * - `<meta name="agent-trust-manifest" content="...">`.
 *
 * Like the ownership meta tag, only `<head>` counts, so user-generated body
 * content can't point an agent at a different manifest.
 *
 * Returns null when there is no pointer or its URL can't be parsed.
 */
export function findManifestLink(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);

  const link = $("head link[rel][href]")
    .toArray()
    .find((el) => ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/).includes(MANIFEST_LINK_REL));
  const meta = $(`head meta[name="${MANIFEST_LINK_REL}" i][content]`).first();

  const raw = link ? $(link).attr("href") : meta.length ? meta.attr("content") : undefined;
  if (!raw?.trim()) return null;

  try {
    return new URL(raw.trim(), pageUrl).href;
  } catch {
    return null;
  }
}
