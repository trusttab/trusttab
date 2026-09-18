import { KNOWN_PRODUCTS, type KnownProduct } from "./known-products";
import { registrableDomain } from "./lookalike";

/**
 * AI Check, Addition 5: does this page present itself *as* a known AI product
 * while sitting on a domain that isn't that product's?
 *
 * Different from the domain-lookalike check (Addition 4), which catches
 * misspellings of a known domain (`paypa1.com`). This one catches a page
 * claiming the name of a known product from an unrelated domain — found in
 * real testing, where a site called "Hermes Agent" sat on hermesagents.net
 * while the real, unaffiliated Hermes Agent is Nous Research's open-source
 * agent at hermes-agent.nousresearch.com.
 *
 * What it reports is the discrepancy itself, never intent: a shared name can
 * mean impersonation, ad arbitrage, or an unrelated product that happens to
 * share a name. The check can't tell those apart, so it doesn't try.
 */

/** Where anyone can publish a page about someone else's product; a name match there means nothing. */
export const PLATFORM_DOMAINS = [
  "github.com", "gitlab.com", "npmjs.com", "pypi.org", "crates.io", "huggingface.co",
  "wikipedia.org", "x.com", "twitter.com", "reddit.com", "youtube.com", "medium.com",
  "substack.com", "dev.to", "linkedin.com", "producthunt.com", "ycombinator.com",
  "discord.com", "notion.site", "apps.apple.com", "play.google.com", "facebook.com",
  "stackoverflow.com", "quora.com", "vercel.app", "netlify.app", "pages.dev", "github.io",
];

/** The page's own claim about what it is. Each field is a separate signal. */
export type PageIdentity = {
  title: string | null;
  ogSiteName: string | null;
  headings: string[];
  structuredDataNames: string[];
};

/**
 * Injected into the active tab: reads what the page calls itself. Fully
 * self-contained (Chrome serializes it). Reads metadata and headings only.
 */
export function collectPageIdentity(): PageIdentity {
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? null;
  const structuredDataNames: string[] = [];
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 5)) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? "");
      for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
        const name = (entry as { name?: unknown })?.name;
        if (typeof name === "string" && name.trim()) structuredDataNames.push(name.trim().slice(0, 120));
      }
    } catch {
      // A page's own broken JSON-LD is not this check's problem.
    }
  }
  return {
    title: document.title?.trim().slice(0, 200) || null,
    ogSiteName: meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]'),
    headings: Array.from(document.querySelectorAll("h1"))
      .slice(0, 3)
      .map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((text) => text.slice(0, 120)),
    structuredDataNames: structuredDataNames.slice(0, 5),
  };
}

/** Lowercase, strip punctuation and collapse spaces, so "Hermes  Agent!" matches "hermes agent". */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9.+# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The part of a title before its tagline: "Hermes Agent — The Agent That
 * Grows With You" and "Hermes Agent: The AI That Grows With You" both claim
 * the name "Hermes Agent". Only the leading segment counts, so a page merely
 * *about* a product ("How to install Hermes Agent") doesn't match.
 */
function titleClaim(title: string): string {
  return title.split(/\s[—–|·]\s|:\s|\s-\s/)[0] ?? title;
}

export type ProductMismatch = {
  product: string;
  vendor: string;
  /** The product's canonical domain, for the wording. */
  canonicalDomain: string;
  /** The domain the page is actually on. */
  domain: string;
  /** Which parts of the page claimed the name. */
  signals: string[];
};

const SIGNAL_LABELS: Record<keyof PageIdentity, string> = {
  title: "page title",
  ogSiteName: "site name metadata",
  headings: "main heading",
  structuredDataNames: "structured data",
};

/**
 * Reports a mismatch when the page claims a known product's name from a
 * domain that isn't the product's, or null. Returns null for the product's
 * own domains, for platforms where anyone can publish, and for pages that
 * merely mention a product.
 */
export function findProductMismatch(identity: PageIdentity, host: string, products: KnownProduct[] = KNOWN_PRODUCTS): ProductMismatch | null {
  const parsed = registrableDomain(host);
  if (!parsed) return null;
  if (PLATFORM_DOMAINS.includes(parsed.domain)) return null;

  const claims: [keyof PageIdentity, string][] = [];
  if (identity.title) claims.push(["title", normalizeName(titleClaim(identity.title))]);
  if (identity.ogSiteName) claims.push(["ogSiteName", normalizeName(identity.ogSiteName)]);
  for (const heading of identity.headings) claims.push(["headings", normalizeName(heading)]);
  for (const name of identity.structuredDataNames) claims.push(["structuredDataNames", normalizeName(name)]);
  if (claims.length === 0) return null;

  for (const product of products) {
    const names = [product.name, ...(product.aliases ?? [])].map(normalizeName);
    const matched = claims.filter(([, claim]) => names.includes(claim));
    if (matched.length === 0) continue;

    // The page is the product's own site, or a subdomain of it.
    if (product.domains.some((domain) => parsed.domain === domain || host.toLowerCase().endsWith(`.${domain}`) || domain.endsWith(`.${parsed.domain}`))) {
      return null;
    }

    // A one-word name needs two independent signals: a single heading saying
    // "Ollama" is weaker evidence of a claim than a title and a site name.
    const distinctSignals = new Set(matched.map(([field]) => field));
    const oneWord = normalizeName(product.name).split(" ").length === 1;
    if (oneWord && distinctSignals.size < 2) continue;

    return {
      product: product.name,
      vendor: product.vendor,
      canonicalDomain: product.domains[0],
      domain: parsed.domain,
      signals: [...distinctSignals].map((field) => SIGNAL_LABELS[field]),
    };
  }
  return null;
}

/** The finding's wording: a checkable discrepancy, never an accusation. */
export function describeProductMismatch(mismatch: ProductMismatch): { title: string; details: string[] } {
  return {
    title: `This page calls itself “${mismatch.product}”, but ${mismatch.domain} isn't one of ${mismatch.product}'s known domains`,
    details: [
      `The ${mismatch.product} on TrustTab's list is ${mismatch.vendor}'s, at ${mismatch.canonicalDomain}. Found in: ${mismatch.signals.join(", ")}.`,
      "A shared name can mean several things — an unrelated product, a reseller, or someone trading on the name — and this check can't tell which.",
      "It only knows a short list of AI products, so finding nothing here is not evidence that a product is genuine.",
    ],
  };
}
