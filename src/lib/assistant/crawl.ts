import "server-only";

import * as cheerio from "cheerio";

import { fetchSitePage, isSameSite } from "@/lib/site-fetch";
import { extractForms, jsRenderingEvidence, type ExtractedForm, type JsRenderingEvidence } from "@/lib/verification/form-extract";
import { scanForInjection } from "@/lib/verification/injection-scan";

/**
 * Crawls a claimed site for forms, for the assistant's draft proposals.
 *
 * Reuses the verification engine's fetcher (SSRF-hardened, same-site
 * redirects only) and form parsing. What reaches the model is structure only:
 * paths, field names, field types and short labels. Never raw page text.
 * Pages flagged by the injection scanner have their labels withheld too, and
 * the flag is reported so the owner hears about it.
 */

const MAX_PAGES = 10;
const LINK_HINT =
  /contact|book|booking|appointment|schedule|reserve|quote|estimate|support|help|ticket|sign-?up|register|waitlist|join|apply|enquir|inquir|cancel|upload|lookup|account|get-started|demo/i;

export type CrawledPage = {
  path: string;
  /** HTTP status, or null if the page couldn't be loaded. */
  status: number | null;
  error?: string;
  forms: ExtractedForm[];
  /**
   * Why the page might have no forms in its HTML: "likely" or "possibly"
   * JS-rendered, with the observed signals. Null if the page couldn't be read.
   */
  jsRendering: JsRenderingEvidence | null;
  /** Number of prompt-injection findings on the page (labels are withheld when > 0). */
  injectionFindings: number;
};

export type CrawlResult = { domain: string; pages: CrawledPage[]; skippedLinks: number };

/** Refuses to crawl TrustTab itself: the assistant must never make requests to its own API. */
function isIssuerHost(domain: string): boolean {
  try {
    const issuer = new URL(process.env.TRUSTTAB_ISSUER_URL ?? "").hostname;
    const auth = new URL(process.env.BETTER_AUTH_URL ?? "").hostname;
    return [issuer, auth].some((h) => h && (h === domain || h === `www.${domain}`));
  } catch {
    return false;
  }
}

export async function crawlSiteForms(domain: string, extraPaths: string[] = []): Promise<CrawlResult> {
  if (isIssuerHost(domain)) {
    throw new Error("The assistant doesn't crawl the TrustTab service itself.");
  }

  const pages: CrawledPage[] = [];
  const home = await fetchSitePage(domain, "/");
  pages.push(inspect("/", home.result));

  const candidates = new Set<string>(extraPaths.filter((p) => /^\/(?!\/)[^\s#]*$/.test(p)));
  let skippedLinks = 0;
  if (home.result.ok) {
    const $ = cheerio.load(home.result.body);
    for (const a of $("a[href]").toArray()) {
      let url: URL;
      try {
        url = new URL($(a).attr("href")!, home.result.finalUrl);
      } catch {
        continue;
      }
      if (!isSameSite(url, domain) || url.pathname === "/") continue;
      if (LINK_HINT.test(url.pathname) || LINK_HINT.test($(a).text())) candidates.add(url.pathname);
    }
  }
  candidates.delete("/");

  const toFetch = [...candidates].slice(0, MAX_PAGES - 1);
  skippedLinks = candidates.size - toFetch.length;
  for (const path of toFetch) {
    const { result } = await fetchSitePage(domain, path);
    pages.push(inspect(path, result));
  }
  return { domain, pages, skippedLinks };
}

function inspect(path: string, result: Awaited<ReturnType<typeof fetchSitePage>>["result"]): CrawledPage {
  if (!result.ok) {
    return { path, status: null, error: result.error, forms: [], jsRendering: null, injectionFindings: 0 };
  }
  if (result.status >= 400) {
    return { path, status: result.status, forms: [], jsRendering: null, injectionFindings: 0 };
  }
  const injectionFindings = scanForInjection(result.body).length;
  const forms = extractForms(result.body).map((form) => ({
    ...form,
    // Labels are page text; withhold them from the model on flagged pages.
    fields: injectionFindings > 0 ? form.fields.map(({ name, type }) => ({ name, type })) : form.fields,
  }));
  return {
    path,
    status: result.status,
    forms,
    jsRendering: jsRenderingEvidence(result.body),
    injectionFindings,
  };
}
