import type { WidgetKind, WidgetSignature } from "./widget-signatures";

/**
 * AI Check 2a: chat and AI agent widget detection. Deterministic pattern
 * matching against WIDGET_SIGNATURES, with no model judgment and no network
 * calls. The page is inspected only when the user opens the AI Check tab, and
 * the evidence never leaves the extension.
 */

/** What the injected script reports back: hostnames and matching selectors, nothing else. */
export type PageEvidence = {
  /** Hostnames of scripts, iframes and network requests the page loaded. */
  hosts: string[];
  /** Which of the requested CSS selectors matched an element on the page. */
  matchedSelectors: string[];
};

/**
 * Injected into the active tab with chrome.scripting.executeScript. It must be
 * fully self-contained: Chrome serializes the function, so it can't use
 * imports or anything from the surrounding module. Runs in the extension's
 * isolated world, reads only the DOM and resource-timing entries, and returns
 * hostnames (not full URLs) and matched selectors.
 */
export function collectPageEvidence(selectors: string[]): PageEvidence {
  const hosts = new Set<string>();
  const addHost = (value: string | null | undefined) => {
    if (!value) return;
    try {
      const url = new URL(value, location.href);
      if (url.protocol === "https:" || url.protocol === "http:") hosts.add(url.hostname.toLowerCase());
    } catch {
      // ignore unparseable URLs
    }
  };
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => addHost(s.src));
  document.querySelectorAll<HTMLIFrameElement>("iframe[src]").forEach((f) => addHost(f.src));
  // Widgets often load scripts that remove their own tags; resource timing still lists them.
  for (const entry of performance.getEntriesByType("resource")) addHost(entry.name);

  const matchedSelectors = selectors.filter((selector) => {
    try {
      return document.querySelector(selector) !== null;
    } catch {
      return false;
    }
  });
  return { hosts: [...hosts], matchedSelectors };
}

export type WidgetDetection = {
  id: string;
  name: string;
  kind: WidgetKind;
  /** The concrete signals that matched, e.g. "script or request from widget.intercom.io". */
  evidence: string[];
};

/** All selectors the signatures use, to pass to collectPageEvidence. */
export function selectorsFor(signatures: WidgetSignature[]): string[] {
  return [...new Set(signatures.flatMap((s) => s.selectors))];
}

/** Matches page evidence against the signature list. Pure. */
export function detectWidgets(evidence: PageEvidence, signatures: WidgetSignature[]): WidgetDetection[] {
  const hosts = evidence.hosts.map((h) => h.toLowerCase());
  const selectors = new Set(evidence.matchedSelectors);
  const detections: WidgetDetection[] = [];

  for (const signature of signatures) {
    const found: string[] = [];
    for (const known of signature.hosts) {
      const match = hosts.find((h) => h === known || h.endsWith(`.${known}`));
      if (match) found.push(`script or request from ${match}`);
    }
    for (const selector of signature.selectors) {
      if (selectors.has(selector)) found.push(`page element ${selector}`);
    }
    if (found.length > 0) detections.push({ id: signature.id, name: signature.name, kind: signature.kind, evidence: found });
  }
  return detections;
}

/** The label shown for a detection. Facts only: see WidgetKind. */
export function detectionLabel(detection: WidgetDetection): { title: string; note?: string } {
  if (detection.kind === "ai_agent") return { title: `AI agent widget detected: ${detection.name}` };
  return {
    title: `Chat widget detected: ${detection.name}`,
    note: `${detection.name} offers AI agents; whether AI answers here isn't visible from the page.`,
  };
}

export type WidgetCheckOutcome =
  | { kind: "result"; detections: WidgetDetection[]; providersChecked: number }
  /** The page couldn't be inspected: a browser page, the Web Store, a PDF viewer, etc. */
  | { kind: "unavailable" }
  /** Running as a plain web page (development preview), where there's no scripting API. */
  | { kind: "preview" };

export type WidgetCheckDisplay = {
  title: string;
  summary: string;
  items: { title: string; note?: string; evidence: string[] }[];
};

/** Popup wording for the widget check. Pure, so the wording is unit tested. */
export function describeWidgetCheck(outcome: WidgetCheckOutcome): WidgetCheckDisplay {
  switch (outcome.kind) {
    case "unavailable":
      return {
        title: "Can't inspect this page",
        summary: "Chrome doesn't let extensions look inside this kind of page (for example browser pages or the Chrome Web Store).",
        items: [],
      };
    case "preview":
      return {
        title: "Page inspection needs the installed extension",
        summary: "This preview runs as a normal web page, which can't look inside other tabs.",
        items: [],
      };
    case "result": {
      const { detections, providersChecked } = outcome;
      if (detections.length === 0) {
        return {
          title: "No known chat or AI agent widgets found",
          summary:
            `Checked for ${providersChecked} known providers. A site can still use one that isn't on the list, ` +
            "or load a widget only later (for example after you scroll or click).",
          items: [],
        };
      }
      const agents = detections.filter((d) => d.kind === "ai_agent").length;
      return {
        title: agents > 0 ? "AI agent widget on this page" : "Chat widget on this page",
        summary: "Matched by the scripts and page elements these widgets are known to use.",
        items: detections.map((d) => ({ ...detectionLabel(d), evidence: d.evidence })),
      };
    }
  }
}
