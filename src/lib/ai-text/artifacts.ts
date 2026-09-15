/**
 * Known artifacts of AI text generation: text a chatbot leaves behind when
 * its reply is pasted into a page. This is the only place they are defined.
 *
 * "Likely AI-written" requires the model to quote something from the page
 * that matches one of these patterns (see applyEvidenceRule in estimate.ts).
 * A list is used because, when asked for artifacts freely, the model quoted
 * stock marketing phrases ("fast-paced digital landscape"). People write
 * those too, so they can't justify calling text AI-written.
 *
 * To add a pattern, append an entry. Keep patterns to things people rarely
 * write in finished page copy (chatbot framing, unfilled placeholders), never
 * style or vocabulary. The model still has to judge that a match is an
 * artifact, and not, say, an article quoting a chatbot.
 */
export const AI_ARTIFACT_PATTERNS: { id: string; pattern: RegExp }[] = [
  { id: "as-an-ai", pattern: /\bas an ai(?: language)? model\b/i },
  { id: "i-am-an-ai", pattern: /\bi(?:'m| am) (?:just )?an ai\b/i },
  { id: "knowledge-cutoff", pattern: /\b(?:my|as of my) (?:last )?(?:knowledge cutoff|training data)\b/i },
  { id: "chatbot-opener", pattern: /\b(?:certainly|sure|absolutely|of course)[!,.]* here(?:'s| is| are)\b/i },
  {
    id: "here-is-your-text",
    pattern:
      /\bhere(?:'s| is) (?:a |an |the |your )(?:revised |rewritten |updated |improved |draft |polished |\d+[- ]word )*(?:blog post|article|version|draft|description|summary|email|copy|paragraph|essay|post|bio|introduction)\b/i,
  },
  { id: "hope-this-helps", pattern: /\bi hope this helps\b/i },
  { id: "let-me-know", pattern: /\blet me know if you(?:'d| would) like (?:me to|any|more|a different)\b/i },
  { id: "regenerate", pattern: /\bregenerate response\b/i },
  {
    id: "placeholder",
    pattern: /\[(?:insert|your|company|business|brand|product|client|customer|name|city|location|address|date|link|url|statistic|number|phone|email)\b[^\]\n]{0,40}\]/i,
  },
];

/** The id of the first pattern `quote` matches, or null. */
export function matchArtifactPattern(quote: string): string | null {
  return AI_ARTIFACT_PATTERNS.find(({ pattern }) => pattern.test(quote))?.id ?? null;
}
