/**
 * Known automated clients, matched against the `User-Agent` of requests to
 * TrustTab's public endpoints (and, later, to a site's own pages).
 *
 * This is the only place these are defined; append entries to extend. It is a
 * different list from the extension's widget signatures: that one identifies
 * chat widgets inside a page, this one identifies who is making a request.
 *
 * A user agent is self-reported and trivially forged, so a match here is only
 * ever an estimate (see display.ts). Cryptographic verification is Tier 1.
 */

export type AgentKind =
  /** An AI crawler, fetcher or assistant retrieving pages. */
  | "ai_agent"
  /** Uptime monitors, security scanners, link checkers: automated, not AI. */
  | "monitor"
  /** TrustTab's own verification fetches, so a site's own checks aren't counted as visitors. */
  | "trusttab";

export type AgentSignature = {
  id: string;
  /** What to call it in the dashboard. */
  name: string;
  operator: string;
  kind: AgentKind;
  /** Matched against the user agent, case-insensitively. */
  pattern: RegExp;
};

export const AGENT_SIGNATURES: AgentSignature[] = [
  // TrustTab's own fetches (src/lib/safe-fetch.ts sends this).
  { id: "trusttab", name: "TrustTab verification", operator: "TrustTab", kind: "trusttab", pattern: /TrustTabBot\//i },

  // AI crawlers and fetchers
  { id: "gptbot", name: "GPTBot", operator: "OpenAI", kind: "ai_agent", pattern: /\bGPTBot\b/i },
  { id: "chatgpt-user", name: "ChatGPT-User", operator: "OpenAI", kind: "ai_agent", pattern: /\bChatGPT-User\b/i },
  { id: "oai-searchbot", name: "OAI-SearchBot", operator: "OpenAI", kind: "ai_agent", pattern: /\bOAI-SearchBot\b/i },
  { id: "claudebot", name: "ClaudeBot", operator: "Anthropic", kind: "ai_agent", pattern: /\bClaudeBot\b/i },
  { id: "claude-user", name: "Claude-User", operator: "Anthropic", kind: "ai_agent", pattern: /\bClaude-User\b/i },
  { id: "claude-searchbot", name: "Claude-SearchBot", operator: "Anthropic", kind: "ai_agent", pattern: /\bClaude-SearchBot\b/i },
  { id: "anthropic-ai", name: "anthropic-ai", operator: "Anthropic", kind: "ai_agent", pattern: /\banthropic-ai\b/i },
  { id: "perplexitybot", name: "PerplexityBot", operator: "Perplexity", kind: "ai_agent", pattern: /\bPerplexityBot\b/i },
  { id: "perplexity-user", name: "Perplexity-User", operator: "Perplexity", kind: "ai_agent", pattern: /\bPerplexity-User\b/i },
  { id: "google-extended", name: "Google-Extended", operator: "Google", kind: "ai_agent", pattern: /\bGoogle-Extended\b/i },
  { id: "googleother", name: "GoogleOther", operator: "Google", kind: "ai_agent", pattern: /\bGoogleOther\b/i },
  { id: "google-cloudvertexbot", name: "Google-CloudVertexBot", operator: "Google", kind: "ai_agent", pattern: /\bGoogle-CloudVertexBot\b/i },
  { id: "bingbot", name: "Bingbot", operator: "Microsoft", kind: "ai_agent", pattern: /\bbingbot\b/i },
  { id: "microsoft-preview", name: "MicrosoftPreview", operator: "Microsoft", kind: "ai_agent", pattern: /\bMicrosoftPreview\b/i },
  { id: "applebot", name: "Applebot", operator: "Apple", kind: "ai_agent", pattern: /\bApplebot(-Extended)?\b/i },
  { id: "meta-externalagent", name: "meta-externalagent", operator: "Meta", kind: "ai_agent", pattern: /\bmeta-externalagent\b|\bfacebookexternalhit\b/i },
  { id: "amazonbot", name: "Amazonbot", operator: "Amazon", kind: "ai_agent", pattern: /\bAmazonbot\b/i },
  { id: "bytespider", name: "Bytespider", operator: "ByteDance", kind: "ai_agent", pattern: /\bBytespider\b/i },
  { id: "ccbot", name: "CCBot", operator: "Common Crawl", kind: "ai_agent", pattern: /\bCCBot\b/i },
  { id: "mistralai-user", name: "MistralAI-User", operator: "Mistral", kind: "ai_agent", pattern: /\bMistralAI-User\b/i },
  { id: "cohere", name: "cohere-ai", operator: "Cohere", kind: "ai_agent", pattern: /\bcohere-(ai|training-data-crawler)\b/i },
  { id: "duckassistbot", name: "DuckAssistBot", operator: "DuckDuckGo", kind: "ai_agent", pattern: /\bDuckAssistBot\b/i },
  { id: "youbot", name: "YouBot", operator: "You.com", kind: "ai_agent", pattern: /\bYouBot\b/i },
  { id: "diffbot", name: "Diffbot", operator: "Diffbot", kind: "ai_agent", pattern: /\bDiffbot\b/i },
  { id: "firecrawl", name: "Firecrawl", operator: "Firecrawl", kind: "ai_agent", pattern: /\bFirecrawlAgent\b|\bfirecrawl\b/i },
  { id: "timpibot", name: "Timpibot", operator: "Timpi", kind: "ai_agent", pattern: /\bTimpibot\b/i },
  { id: "omgili", name: "omgili", operator: "Webz.io", kind: "ai_agent", pattern: /\bomgili(bot)?\b/i },

  // Automated, but not AI agents: worth separating so they aren't miscounted.
  { id: "uptimerobot", name: "UptimeRobot", operator: "UptimeRobot", kind: "monitor", pattern: /\bUptimeRobot\b/i },
  { id: "pingdom", name: "Pingdom", operator: "Pingdom", kind: "monitor", pattern: /\bPingdom\b/i },
  { id: "statuscake", name: "StatusCake", operator: "StatusCake", kind: "monitor", pattern: /\bStatusCake\b/i },
  { id: "betteruptime", name: "Better Stack", operator: "Better Stack", kind: "monitor", pattern: /\bBetter\s?Uptime\b|\bBetterStack\b/i },
  { id: "datadog", name: "Datadog Synthetics", operator: "Datadog", kind: "monitor", pattern: /\bDatadogSynthetics\b/i },
  { id: "site24x7", name: "Site24x7", operator: "Site24x7", kind: "monitor", pattern: /\bSite24x7\b/i },
  { id: "curl", name: "curl", operator: "—", kind: "monitor", pattern: /^curl\/[\d.]+$/i },
  { id: "wget", name: "Wget", operator: "—", kind: "monitor", pattern: /^Wget\/[\d.]+/i },
  { id: "python-requests", name: "python-requests", operator: "—", kind: "monitor", pattern: /^python-requests\//i },
];

export function matchAgentSignature(userAgent: string | null | undefined): AgentSignature | null {
  if (!userAgent) return null;
  return AGENT_SIGNATURES.find(({ pattern }) => pattern.test(userAgent)) ?? null;
}
