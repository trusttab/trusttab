import "server-only";

import { safeFetchText, type SafeFetchResult } from "./safe-fetch";

/** True for https URLs on `domain` or `www.domain`. */
export function isSameSite(url: URL, domain: string): boolean {
  return url.protocol === "https:" && (url.hostname === domain || url.hostname === `www.${domain}`);
}

/**
 * Fetches `path` on a claimed site, e.g. `fetchSitePage("example.com", "/contact")`.
 *
 * - Redirects are followed only between `domain` and `www.domain` (plus any
 *   extra targets the caller explicitly allows), so an open redirect elsewhere
 *   can't be used to satisfy a check.
 * - Some sites only answer on www. If the apex fails at the connection level
 *   we retry on www; if the apex responded at all, that response stands.
 *
 * `requestedUrl` is the URL we asked for first, useful in messages when the
 * fetch failed before producing a final URL.
 */
export async function fetchSitePage(
  domain: string,
  path: string,
  options: { alsoAllowRedirect?: (url: URL) => boolean } = {},
): Promise<{ requestedUrl: string; result: SafeFetchResult }> {
  const allowRedirect = (url: URL) =>
    isSameSite(url, domain) || (options.alsoAllowRedirect?.(url) ?? false);

  const requestedUrl = `https://${domain}${path}`;
  const result = await safeFetchText(requestedUrl, { allowRedirect });
  if (result.ok || result.error.startsWith("Redirected")) return { requestedUrl, result };

  const wwwResult = await safeFetchText(`https://www.${domain}${path}`, { allowRedirect });
  return wwwResult.ok ? { requestedUrl: `https://www.${domain}${path}`, result: wwwResult } : { requestedUrl, result };
}
