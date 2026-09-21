/**
 * AI Check, Addition 6: does the page's own published metadata describe an AI
 * capability?
 *
 * Found by real-world testing: leasetab.com ("an AI-powered leasing OS"),
 * Vapi ("deploy advanced voice AI agents") and GoDaddy's Airo all pass the
 * widget and native-platform checks untouched. That isn't a bug in those —
 * they were built for two specific things, famous consumer chatbot domains and
 * known third-party widget vendors, and neither covers a company's own custom
 * AI feature described in its own marketing copy.
 *
 * **This reads only structured, self-published metadata** — the meta
 * description, Open Graph tags, and schema.org fields a company controls and
 * stands behind. It deliberately does not read visible page prose: that is the
 * tone-and-vibe judgment the spec rejects, and it would flag any page that
 * happens to discuss AI.
 *
 * A match is stated as fact, because it is the site's own sentence, quoted
 * back. It is informational and **does not feed the summary badge**: a company
 * truthfully describing its own AI feature is not a concern, and treating it as
 * one would be the "AI-made = suspicious" framing this project refuses.
 */

export type AiTerm = {
  id: string;
  /** Matched case-insensitively unless `caseSensitive`. */
  pattern: RegExp;
  label: string;
  /**
   * "AI" alone is two letters that occur as an ordinary word in other
   * languages (Italian, French) and inside unrelated abbreviations. It is
   * matched case-sensitively so `AI` counts and `ai` doesn't.
   */
  caseSensitive?: boolean;
};

/**
 * The only place terms are defined; append to extend. Keep each specific
 * enough that its presence in a company's own description really does mean
 * "we have an AI feature".
 */
export const AI_TERMS: AiTerm[] = [
  { id: "ai", pattern: /\bAI\b/, label: "AI", caseSensitive: true },
  { id: "ai-hyphen", pattern: /\bAI-(?:powered|driven|based|native|enabled|first|assisted)\b/, label: "AI-powered", caseSensitive: true },
  { id: "artificial-intelligence", pattern: /\bartificial intelligence\b/i, label: "artificial intelligence" },
  { id: "chatbot", pattern: /\bchat ?bots?\b/i, label: "chatbot" },
  { id: "virtual-assistant", pattern: /\bvirtual assistants?\b/i, label: "virtual assistant" },
  { id: "ai-agent", pattern: /\bAI agents?\b/, label: "AI agent", caseSensitive: true },
  { id: "ai-receptionist", pattern: /\bAI receptionists?\b/, label: "AI receptionist", caseSensitive: true },
  { id: "voice-agent", pattern: /\bvoice (?:AI|agents?)\b/, label: "voice agent", caseSensitive: true },
  { id: "copilot", pattern: /\bco-?pilots?\b/i, label: "copilot" },
  { id: "llm", pattern: /\b(?:large language model|LLM)s?\b/, label: "large language model", caseSensitive: true },
  { id: "generative", pattern: /\bgenerative (?:AI|intelligence)\b/i, label: "generative AI" },
  { id: "machine-learning", pattern: /\bmachine learning\b/i, label: "machine learning" },
  { id: "gpt", pattern: /\bGPT-?[0-9]?\b/, label: "GPT", caseSensitive: true },
];

/**
 * Text that means the sentence is *denying* or *contrasting with* AI rather
 * than claiming it — "no AI involved", "an alternative to AI chatbots",
 * "without AI". Same approach as the sensitive-request check's negation list,
 * for the same reason: the term appearing is not the same as the claim being
 * made.
 */
export const NEGATION_PATTERNS: RegExp[] = [
  /\b(?:no|without|never|zero|not)\s+(?:any\s+)?(?:AI|artificial intelligence|chatbots?)\b/i,
  /\b(?:alternatives?|alternative to|instead of|replaces?|unlike|versus|vs\.?)\s+(?:an?\s+)?(?:AI|artificial intelligence|chatbots?)\b/i,
  /\b(?:human|real people|real humans?)[^.!?]{0,30}\bnot\b[^.!?]{0,20}\b(?:AI|bots?)\b/i,
  /\bAI-free\b/i,
];

/** Where a claim was found. Named so the user can go and look at it. */
export type AiSource = "meta description" | "og:description" | "og:title" | "structured data";

export type AiSelfDescription = {
  source: AiSource;
  /** The matched term, for grouping. */
  term: string;
  /** The site's own sentence, quoted, so the reader judges it themselves. */
  quote: string;
};

/** What the page published about itself, as the collector reads it. */
export type PageMetadata = {
  description: string | null;
  ogDescription: string | null;
  ogTitle: string | null;
  /** description / keywords / applicationCategory from schema.org entries. */
  structuredData: string[];
};

const MAX_QUOTE = 200;

/** The sentence containing the match, so a term is never shown without its context. */
function sentenceAround(text: string, index: number): string {
  const flat = text.replace(/\s+/g, " ");
  const before = flat.lastIndexOf(". ", index);
  const after = flat.indexOf(". ", index);
  const start = before === -1 ? 0 : before + 2;
  const end = after === -1 ? flat.length : after + 1;
  const sentence = flat.slice(start, Math.min(end, start + MAX_QUOTE)).trim();
  return sentence.length < flat.length ? sentence : flat.slice(0, MAX_QUOTE).trim();
}

function findIn(text: string | null, source: AiSource): AiSelfDescription[] {
  if (!text || text.length < 3) return [];
  if (NEGATION_PATTERNS.some((pattern) => pattern.test(text))) return [];

  const found: AiSelfDescription[] = [];
  for (const term of AI_TERMS) {
    const pattern = new RegExp(term.pattern.source, term.caseSensitive ? "" : "i");
    const match = pattern.exec(text);
    if (!match) continue;
    if (found.some((existing) => existing.term === term.label)) continue;
    found.push({ source, term: term.label, quote: sentenceAround(text, match.index) });
  }
  return found;
}

/**
 * Reads the page's own metadata for an AI claim. Returns every distinct
 * (source, term) pair found, so the display can quote each one.
 */
export function findAiSelfDescription(metadata: PageMetadata): AiSelfDescription[] {
  const results = [
    ...findIn(metadata.description, "meta description"),
    ...findIn(metadata.ogDescription, "og:description"),
    ...findIn(metadata.ogTitle, "og:title"),
    ...metadata.structuredData.flatMap((entry) => findIn(entry, "structured data")),
  ];

  // One entry per term, preferring the first source it was found in, so a
  // description repeated across meta and og doesn't read as two findings.
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.term)) return false;
    seen.add(result.term);
    return true;
  });
}

/**
 * Injected into the active tab. Self-contained (Chrome serializes it), and
 * reads only metadata the site published about itself — never body text.
 */
export function collectPageMetadata(): PageMetadata {
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null;
  const structuredData: string[] = [];
  const TYPES = ["Organization", "WebApplication", "SoftwareApplication", "Product", "WebSite"];

  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 5)) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? "");
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries.slice(0, 10)) {
        const node = entry as Record<string, unknown>;
        const type = node?.["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (!types.some((t) => typeof t === "string" && TYPES.includes(t))) continue;
        for (const field of ["description", "keywords", "applicationCategory", "slogan"]) {
          const value = node[field];
          if (typeof value === "string" && value.trim()) structuredData.push(value.trim().slice(0, 400));
          else if (Array.isArray(value)) {
            for (const item of value) if (typeof item === "string" && item.trim()) structuredData.push(item.trim().slice(0, 400));
          }
        }
      }
    } catch {
      // A page's own broken JSON-LD is not this check's problem.
    }
  }

  return {
    description: meta('meta[name="description"]'),
    ogDescription: meta('meta[property="og:description"]'),
    ogTitle: meta('meta[property="og:title"]'),
    structuredData: structuredData.slice(0, 10),
  };
}

/** The completeness caveat, shown wherever this check's result appears. */
export const AI_SELF_DESCRIPTION_CAVEAT =
  "This reads only what the site published about itself in its metadata, in a fixed list of terms. Finding nothing doesn't mean the page has no AI feature — only that its own description didn't say so in those words.";
