/**
 * AI Check, Addition 2: does a chat or form on the page ask for
 * credential-shaped information *and* push urgency?
 *
 * Both halves must appear in the same block of text, and the block must not
 * be a warning about such requests ("we will never ask for your password").
 * Either half alone is normal: businesses ask for emails, and "limited time
 * offer" is ordinary marketing (EXTENSION_SPEC "What NOT to build"). Only the
 * combination is reported, and only as what was found, never as a verdict.
 *
 * Pattern matching only: no model, no network, no tone or style judgment.
 * The lists below are the only place patterns are defined; append to extend.
 */

export type RequestPattern = { id: string; label: string; pattern: RegExp };

/** A verb phrase asking the reader to hand something over, within ~40 characters of the item. */
const ASK = String.raw`(?:enter|input|provide|supply|confirm|verify|validate|share|send|text|type|give|tell|read out|update)`;

export const SENSITIVE_REQUEST_PATTERNS: RequestPattern[] = [
  { id: "password", label: "password", pattern: new RegExp(String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:your |the |account )*(?:password|passphrase)\b`, "i") },
  { id: "pin", label: "PIN", pattern: new RegExp(String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:your |the |account |card )*PIN\b`, "i") },
  {
    id: "otp",
    label: "one-time verification code",
    pattern: new RegExp(
      String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:one[- ]time|verification|security|authentication|confirmation|2fa|otp|sms|6[- ]digit)\s*(?:code|pin|password)\b`,
      "i",
    ),
  },
  {
    id: "card-number",
    label: "full card number",
    pattern: new RegExp(String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:full |complete |entire |16[- ]digit )*(?:credit |debit |bank )*card\s*number\b`, "i"),
  },
  { id: "cvv", label: "card security code (CVV)", pattern: new RegExp(String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:cvv|cvc|card security code|security code on the back)\b`, "i") },
  { id: "ssn", label: "Social Security number", pattern: new RegExp(String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:social security number|\bssn\b)`, "i") },
  {
    id: "bank-account",
    label: "bank account or routing number",
    pattern: new RegExp(String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:bank account|routing|sort code|iban)\s*(?:number|code)?\b`, "i"),
  },
  {
    id: "recovery-phrase",
    label: "crypto wallet recovery phrase or private key",
    pattern: new RegExp(String.raw`\b${ASK}\b[^.!?\n]{0,40}\b(?:seed phrase|recovery phrase|secret phrase|private key|12[- ]word phrase|24[- ]word phrase)\b`, "i"),
  },
  {
    id: "remote-access",
    label: "remote access to your device",
    pattern: new RegExp(String.raw`\b(?:install|download|run|open)\b[^.!?\n]{0,40}\b(?:anydesk|teamviewer|remote (?:access|desktop|support) (?:tool|software|app))\b`, "i"),
  },
];

export const URGENCY_PATTERNS: RequestPattern[] = [
  {
    id: "suspension",
    label: "account suspension or closure",
    pattern: /\b(?:account|access|card|payment)\b[^.!?\n]{0,40}\b(?:suspend\w*|lock\w*|block\w*|clos\w+|terminat\w+|deactivat\w+|restrict\w+|frozen|freeze)\b/i,
  },
  { id: "act-now", label: "act now / immediately", pattern: /\b(?:act now|right now|immediately|urgent(?:ly)?|as soon as possible|do not delay|don'?t delay)\b/i },
  { id: "deadline", label: "a countdown or deadline", pattern: /\b(?:within|in) (?:the next )?\d+ (?:seconds?|minutes?|hours?)\b|\b(?:expires?|expiring|deadline)\b[^.!?\n]{0,30}\b(?:today|now|soon|\d+ (?:minutes?|hours?))\b/i },
  { id: "avoid-loss", label: "a threat of losing access, money or data", pattern: /\b(?:to )?(?:avoid|prevent|stop)\b[^.!?\n]{0,40}\b(?:suspension|closure|termination|losing|loss of|deletion|charges?|fees?|penalt\w+)\b/i },
  { id: "final-notice", label: "a final notice", pattern: /\b(?:final (?:notice|warning|reminder)|last chance|last warning)\b/i },
];

/**
 * Text that means the block is *warning* about these requests rather than
 * making one. Security notices legitimately name passwords and urgency.
 */
export const NEGATION_PATTERNS: RegExp[] = [
  /\b(?:never|not|won'?t|will not|do not|don'?t)\b[^.!?\n]{0,30}\b(?:ask|request|email|call|text)\b[^.!?\n]{0,30}\b(?:for )?(?:your )?(?:password|pin|code|cvv|card number|details)\b/i,
  /\b(?:never|do not|don'?t)\b[^.!?\n]{0,20}\bshare\b/i,
  /\b(?:beware|watch out|be aware|report)\b[^.!?\n]{0,30}\b(?:phishing|scams?|fraud|fake)\b/i,
  /\bphishing\b[^.!?\n]{0,30}\b(?:awareness|protection|warning|attempt)\b/i,
];

export type SensitiveRequestFinding = {
  /** Which sensitive items were asked for, in plain words. */
  requested: string[];
  /** Which urgency patterns appeared alongside them. */
  urgency: string[];
  /** A short quote of the text that matched, for the user to judge. */
  quote: string;
};

const MAX_QUOTE_CHARS = 160;

/** A short excerpt around the first match, cut at word boundaries, so the finding shows the actual words. */
function quoteAround(text: string, match: RegExpMatchArray): string {
  const flat = text.replace(/\s+/g, " ");
  const at = flat.indexOf(match[0].replace(/\s+/g, " "));
  const from = Math.max(0, (at < 0 ? 0 : at) - 30);
  // Start at the next word boundary, so a quote never begins mid-word.
  const start = from === 0 ? 0 : from + Math.max(0, flat.slice(from).indexOf(" ") + 1);
  let excerpt = flat.slice(start, start + MAX_QUOTE_CHARS).trim();
  const clipped = start + MAX_QUOTE_CHARS < flat.length;
  if (clipped) excerpt = excerpt.slice(0, excerpt.lastIndexOf(" ")).replace(/[\s,;:.\-]+$/, "");
  return `${start > 0 ? "…" : ""}${excerpt}${clipped ? "…" : ""}`;
}

/**
 * Checks blocks of chat/form text. Returns a finding only when one block both
 * asks for something credential-shaped and applies urgency, and isn't a
 * warning about such requests.
 */
export function findSensitiveRequest(blocks: string[]): SensitiveRequestFinding | null {
  for (const block of blocks) {
    if (typeof block !== "string" || block.length < 20) continue;
    if (NEGATION_PATTERNS.some((pattern) => pattern.test(block))) continue;

    const requested: string[] = [];
    let firstMatch: RegExpMatchArray | null = null;
    for (const { label, pattern } of SENSITIVE_REQUEST_PATTERNS) {
      const match = block.match(pattern);
      if (!match) continue;
      if (!requested.includes(label)) requested.push(label);
      firstMatch ??= match;
    }
    if (requested.length === 0) continue;

    const urgency = URGENCY_PATTERNS.filter(({ pattern }) => pattern.test(block)).map(({ label }) => label);
    if (urgency.length === 0) continue;

    return { requested, urgency, quote: quoteAround(block, firstMatch!) };
  }
  return null;
}

/**
 * Injected into the active tab: collects the visible text of chat widgets,
 * dialogs and forms, which is what this check reads. Self-contained (Chrome
 * serializes it). Cross-origin chat widgets render in iframes the extension
 * can't read, so those are invisible to this check.
 */
export function collectRequestBlocks(chatSelectors: string[], maxBlocks: number, maxChars: number): string[] {
  const selectors = [...chatSelectors, "form", "[role=dialog]", "[role=alertdialog]", "[aria-live]"];
  const blocks: string[] = [];
  const seen = new Set<Element>();
  for (const selector of selectors) {
    let elements: Element[];
    try {
      elements = Array.from(document.querySelectorAll(selector));
    } catch {
      continue;
    }
    for (const element of elements) {
      if (seen.has(element) || blocks.length >= maxBlocks) continue;
      seen.add(element);
      if (!(element instanceof HTMLElement) || !element.checkVisibility({ visibilityProperty: true })) continue;
      const parts = [element.innerText ?? ""];
      // Labels and placeholders carry the request in many forms.
      element.querySelectorAll("input, textarea").forEach((field) => {
        const input = field as HTMLInputElement;
        parts.push(input.placeholder ?? "", input.getAttribute("aria-label") ?? "", input.labels?.[0]?.innerText ?? "");
      });
      const text = parts.filter(Boolean).join("\n").replace(/[ \t]+/g, " ").trim();
      if (text.length >= 20) blocks.push(text.slice(0, maxChars));
    }
  }
  return blocks;
}
