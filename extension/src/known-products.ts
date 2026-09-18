/**
 * Known AI agent and AI tool products, mapped to the domains they actually
 * run on. Used by the brand-mismatch check (see product-mismatch.ts): a page
 * that presents itself *as* one of these, on a domain that isn't theirs, is a
 * checkable discrepancy.
 *
 * This is the only place products are defined; append entries to extend. Two
 * rules keep it honest:
 *
 * 1. **Every domain a product legitimately uses must be listed**, including
 *    the vendor's main site and any docs or app subdomain. A missing domain
 *    would make the product's own page look like an impersonation.
 * 2. **Only names unlikely to belong to someone else.** Products named after
 *    ordinary words (Cursor, Devin, Manus, Lovable, Windsurf, Comet, Gemini) are
 *    deliberately left out: another business may legitimately use that name,
 *    and a false "this isn't the real X" is the harm to avoid. Coined
 *    single-word names are allowed but need two independent signals on the
 *    page (see product-mismatch.ts).
 *
 * The list is small and the space of AI products is large and growing, so
 * silence from this check is never evidence a product is genuine. The UI says
 * so. Like the widget signatures and trust lists, it goes stale and needs
 * periodic review (CLAUDE.md, open questions).
 *
 * Domains verified live on 2026-09-17.
 */

export type KnownProduct = {
  id: string;
  /** The product's name as it writes it. */
  name: string;
  /** Other spellings that mean the same product. */
  aliases?: string[];
  vendor: string;
  /** Every domain the product legitimately uses; the first is the canonical one shown to the user. */
  domains: string[];
};

export const KNOWN_PRODUCTS: KnownProduct[] = [
  {
    id: "hermes-agent",
    name: "Hermes Agent",
    vendor: "Nous Research",
    domains: ["hermes-agent.nousresearch.com", "nousresearch.com"],
  },
  { id: "chatgpt", name: "ChatGPT", aliases: ["ChatGPT Atlas"], vendor: "OpenAI", domains: ["chatgpt.com", "openai.com", "chat.openai.com"] },
  { id: "claude-code", name: "Claude Code", vendor: "Anthropic", domains: ["claude.com", "claude.ai", "anthropic.com"] },
  { id: "github-copilot", name: "GitHub Copilot", vendor: "GitHub", domains: ["github.com", "copilot.microsoft.com", "microsoft.com"] },
  { id: "perplexity", name: "Perplexity", vendor: "Perplexity AI", domains: ["perplexity.ai"] },
  { id: "langchain", name: "LangChain", aliases: ["LangGraph", "LangSmith"], vendor: "LangChain", domains: ["langchain.com"] },
  { id: "llamaindex", name: "LlamaIndex", vendor: "LlamaIndex", domains: ["llamaindex.ai"] },
  { id: "crewai", name: "CrewAI", vendor: "CrewAI", domains: ["crewai.com"] },
  { id: "openhands", name: "OpenHands", vendor: "All Hands AI", domains: ["openhands.dev", "all-hands.dev"] },
  { id: "browser-use", name: "Browser Use", vendor: "Browser Use", domains: ["browser-use.com"] },
  { id: "lm-studio", name: "LM Studio", vendor: "Element Labs", domains: ["lmstudio.ai"] },
  { id: "ollama", name: "Ollama", vendor: "Ollama", domains: ["ollama.com", "ollama.ai"] },
  { id: "n8n", name: "n8n", vendor: "n8n", domains: ["n8n.io"] },
  { id: "replit", name: "Replit", aliases: ["Replit Agent"], vendor: "Replit", domains: ["replit.com"] },
  { id: "base44", name: "Base44", vendor: "Base44 (Wix)", domains: ["base44.com", "base44.app"] },
  { id: "bolt-new", name: "bolt.new", aliases: ["Bolt.new"], vendor: "StackBlitz", domains: ["bolt.new", "stackblitz.com"] },
];
