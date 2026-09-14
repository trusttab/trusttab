import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Check 2 — prompt-injection content scan (pure: HTML in, findings out).
 *
 * Design rule: false positives damage trust in the badge faster than false
 * negatives, so the pattern list is short and specific. Two kinds of finding:
 *
 * 1. `injection_phrase` — unambiguous injection language ("ignore previous
 *    instructions", chat-template role markers…) anywhere a reading agent
 *    would see it: visible or hidden text, HTML comments, or text-bearing
 *    attributes. There is no legitimate reason for these on a form page.
 *
 * 2. `hidden_agent_text` — text hidden from humans (inline `display:none`,
 *    `visibility:hidden`, zero size/opacity, off-screen positioning, the
 *    `hidden` attribute, or explicit white-on-white) that both names an AI
 *    model/agent and gives it directions. Hidden text alone is normal (menus,
 *    modals), so both conditions are required.
 *
 * Not inspected: <script> and <style> contents (AI chat widgets legitimately
 * ship prompt-defense strings), and styles applied through CSS classes —
 * only inline styles are evaluated.
 */

export type InjectionFinding = {
  kind: "injection_phrase" | "hidden_agent_text";
  /** What matched, in words an owner can act on. */
  description: string;
  /** Up to ~120 characters of surrounding text. */
  excerpt: string;
};

const INJECTION_PHRASES: { pattern: RegExp; description: string }[] = [
  {
    pattern:
      /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+)?(of\s+)?(the\s+|your\s+|my\s+)?(previous|prior|above|earlier|preceding|original)\s+(instructions|prompts?|directions|rules|guidelines)\b/i,
    description: 'Instruction-override phrase (e.g. "ignore previous instructions")',
  },
  {
    pattern: /<\|(im_start|im_end|system|assistant|user)\|>|\[\/?INST\]|<<\/?SYS>>/i,
    description: "Chat-template role marker (fake system/assistant message)",
  },
  {
    pattern: /\b(reveal|print|repeat|ignore|override|bypass)\s+(your|the)\s+system\s+prompt\b/i,
    description: "Attempt to read or override an agent's system prompt",
  },
];

const AI_SUBJECT = /\b(ai|a\.i\.|llms?|language models?|chatgpt|gpt-?\d*|claude|gemini|copilot|ai (agents?|assistants?))\b/i;
const DIRECTIVE =
  /\b(ignore|disregard|pretend|override|reveal|instructions?|do not (tell|mention|reveal|disclose)|don't (tell|mention|reveal)|you (must|should|are required to|will now))\b/i;

const HIDDEN_STYLE =
  /(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(\.0+)?\s*(;|$)|font-size\s*:\s*0(px|em|rem|%)?\s*(;|$)|(left|top|text-indent)\s*:\s*-\d{4,}px|clip\s*:\s*rect\(\s*0)/i;
const WHITE = /^(#fff|#ffffff|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i;

const MIN_HIDDEN_TEXT = 20;

export function scanForInjection(html: string): InjectionFinding[] {
  const $ = cheerio.load(html);
  $("script, style").remove();

  const findings: InjectionFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: InjectionFinding) => {
    const key = `${finding.kind}|${finding.excerpt}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  // Everything an agent reading the raw page might ingest.
  const sources: string[] = [normalize($.root().text())];
  $("*")
    .contents()
    .each((_, node) => {
      if (node.type === "comment") sources.push(normalize(node.data));
    });
  $("[alt], [title], [aria-label], [placeholder], meta[content]").each((_, el) => {
    for (const attr of ["alt", "title", "aria-label", "placeholder", "content"]) {
      const value = $(el).attr(attr);
      if (value) sources.push(normalize(value));
    }
  });

  for (const text of sources) {
    for (const { pattern, description } of INJECTION_PHRASES) {
      const match = pattern.exec(text);
      if (match) add({ kind: "injection_phrase", description, excerpt: excerptAround(text, match.index, match[0].length) });
    }
  }

  // Hidden elements whose text addresses an AI and directs it.
  $("*").each((_, el) => {
    if (!isHidden($, el)) return;
    // Skip elements nested in an already-reported hidden ancestor.
    if ($(el).parents().toArray().some((p) => isHidden($, p))) return;
    const text = normalize($(el).text());
    if (text.length >= MIN_HIDDEN_TEXT && AI_SUBJECT.test(text) && DIRECTIVE.test(text)) {
      add({
        kind: "hidden_agent_text",
        description: "Text hidden from human visitors that gives directions to AI agents",
        excerpt: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      });
    }
  });

  return findings;
}

function isHidden($: cheerio.CheerioAPI, el: AnyNode): boolean {
  const $el = $(el);
  if ($el.is("[hidden]")) return true;
  const style = $el.attr("style");
  if (!style) return false;
  if (HIDDEN_STYLE.test(style)) return true;

  // White-on-white, only when both colors are explicit inline styles.
  const color = inlineStyleValue(style, "color");
  if (!color || !WHITE.test(color)) return false;
  const withBackground = [el, ...$el.parents().toArray()].find((n) => {
    const s = $(n).attr("style");
    return s && (inlineStyleValue(s, "background-color") ?? inlineStyleValue(s, "background"));
  });
  if (!withBackground) return false;
  const s = $(withBackground).attr("style")!;
  const background = (inlineStyleValue(s, "background-color") ?? inlineStyleValue(s, "background"))!;
  return WHITE.test(background);
}

function inlineStyleValue(style: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(style);
  return match?.[1].trim().replace(/\s*!important$/i, "");
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
