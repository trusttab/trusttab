import { normalizeDomain } from "@/lib/domain";
import { parseRegistryResponse, type LookupOutcome } from "@/lib/registry-display";

/**
 * Turns the active tab's URL into the domain TrustTab would look up, or a
 * reason there's nothing to check. Uses the app's own normalizeDomain, so the
 * extension and the server agree on what "the domain" is (lowercase, punycode,
 * no leading www.).
 */
export function domainFromTabUrl(tabUrl: string | undefined): { ok: true; domain: string } | { ok: false; reason: string } {
  if (!tabUrl) return { ok: false, reason: "TrustTab can't see this tab's address." };
  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return { ok: false, reason: "TrustTab can't read this tab's address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "TrustTab checks websites. This is a browser or local page." };
  }
  const normalized = normalizeDomain(url.hostname);
  if (!normalized.ok) return { ok: false, reason: "TrustTab only checks public websites." };
  return { ok: true, domain: normalized.domain };
}

const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Looks up a domain in the TrustTab registry. Called only when the user opens
 * the popup: the extension never sends the sites someone visits in the
 * background. Any unexpected response is reported as "couldn't check", never
 * as a verdict about the site.
 */
export async function lookupDomain(
  apiBase: string,
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LookupOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase}/api/verify/by-domain/${encodeURIComponent(domain)}`, {
      headers: { accept: "application/json" },
      credentials: "omit",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    return { kind: "error", message: "TrustTab couldn't be reached. Check your connection and try again." };
  }

  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 400) return { kind: "not_applicable", reason: "TrustTab only checks public websites." };
  if (res.status === 429) return { kind: "error", message: "Too many lookups in a short time. Try again in a minute." };
  if (!res.ok) return { kind: "error", message: `TrustTab had a problem answering (HTTP ${res.status}). Try again later.` };

  const entry = parseRegistryResponse(await res.json().catch(() => null));
  if (!entry) return { kind: "error", message: "TrustTab sent a response the extension didn't understand." };
  return { kind: "entry", entry };
}
