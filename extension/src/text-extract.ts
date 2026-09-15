/**
 * AI Check 2b: extracts the page's visible main text, to send for an
 * estimate only after the user clicks "Check this page's writing".
 *
 * Injected with chrome.scripting.executeScript, so it must be fully
 * self-contained (Chrome serializes the function; no imports or outside
 * references). It reads the page and returns text; it sends nothing itself.
 *
 * What counts as main text: the page's <main>, <article> or [role=main] if it
 * has one, otherwise <body>, skipping navigation, headers, footers, sidebars,
 * forms, buttons, scripts, and anything hidden with `display: none` or
 * `visibility: hidden` (so hidden text isn't judged as page content).
 */
export function extractMainText(maxChars: number): { text: string; truncated: boolean } {
  const SKIP =
    "nav, header, footer, aside, form, script, style, noscript, template, svg, canvas, iframe, button, select, textarea," +
    " [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search], [role=dialog]," +
    " [aria-hidden=true], [hidden]";

  const root =
    document.querySelector<HTMLElement>("main, [role=main]") ??
    (document.querySelectorAll("article").length === 1 ? document.querySelector<HTMLElement>("article") : null) ??
    document.body;
  if (!root) return { text: "", truncated: false };

  const visibleCache = new Map<Element, boolean>();
  const isVisible = (el: Element): boolean => {
    let cached = visibleCache.get(el);
    if (cached === undefined) {
      // Not opacity: scroll-reveal animations keep below-the-fold sections at
      // opacity 0 until scrolled to (on leasetab.com that was ~75% of the text).
      cached = el.checkVisibility({ visibilityProperty: true });
      visibleCache.set(el, cached);
    }
    return cached;
  };

  // The nearest ancestor that isn't inline: text in the same block joins with
  // a space, and a new block starts a new line (so a link mid-sentence doesn't
  // break the sentence, but paragraphs don't run together).
  const blockCache = new Map<Element, Element>();
  const blockOf = (el: Element): Element => {
    let cached = blockCache.get(el);
    if (!cached) {
      let current: Element = el;
      while (current !== root && current.parentElement && getComputedStyle(current).display.startsWith("inline")) {
        current = current.parentElement;
      }
      cached = current;
      blockCache.set(el, cached);
    }
    return cached;
  };

  const chunks: string[] = [];
  let length = 0;
  let truncated = false;
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const value = node.nodeValue?.replace(/\s+/g, " ").trim();
    if (!parent || !value) continue;
    // Skip regions are checked from the text's parent upward, stopping at the chosen root.
    const skipped = parent.closest(SKIP);
    if (skipped && root.contains(skipped) && skipped !== root) continue;
    if (!isVisible(parent)) continue;

    const block = blockOf(parent);
    chunks.push(block === lastBlock ? ` ${value}` : `\n${value}`);
    lastBlock = block;
    length += value.length + 1;
    if (length >= maxChars) {
      truncated = true;
      break;
    }
  }
  const text = chunks.join("").replace(/ +([.,;:!?)])/g, "$1").replace(/ +/g, " ").replace(/\n+ ?/g, "\n").trim();
  return { text: text.slice(0, maxChars), truncated };
}
