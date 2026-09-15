import { describeTextEstimate, MAX_CHARS, type TextEstimateOutcome } from "@/lib/ai-text/display";
import { describeLookup, type LookupOutcome } from "@/lib/registry-display";

import { domainFromTabUrl, lookupDomain } from "./lookup";
import { requestTextEstimate } from "./text-estimate";
import { extractMainText } from "./text-extract";
import { WIDGET_SIGNATURES } from "./widget-signatures";
import { collectPageEvidence, describeWidgetCheck, detectWidgets, selectorsFor, type WidgetCheckOutcome } from "./widgets";

/** TrustTab instance to query; set at build time (see extension/build.mjs). */
declare const __TRUSTTAB_URL__: string;
const API_BASE = __TRUSTTAB_URL__;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The active tab's URL. In the extension this comes from the `activeTab`
 * permission, granted only because the user clicked the toolbar button.
 * Opened as a plain web page (for development previews), there is no
 * `chrome.tabs`, so a `?url=` query parameter stands in.
 */
async function activeTabUrl(): Promise<string | undefined> {
  if (typeof chrome !== "undefined" && chrome.tabs?.query) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url;
  }
  return new URLSearchParams(location.search).get("url") ?? undefined;
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function render(domain: string | null, outcome: LookupOutcome) {
  const display = describeLookup(outcome, formatDate);

  const card = $("status-card");
  card.dataset.tone = display.tone;
  card.setAttribute("aria-busy", "false");
  // Always textContent, never innerHTML: domains and endpoint paths come from the network.
  $("status-title").textContent = display.title;
  $("status-summary").textContent = display.summary;
  $("status-domain").textContent = domain ?? "";
  $("status-domain").hidden = !domain;

  const finding = $("status-finding");
  finding.textContent = display.finding ?? "";
  finding.hidden = !display.finding;

  const facts = $("status-facts");
  facts.replaceChildren(
    ...display.facts.map((fact) => {
      const li = document.createElement("li");
      li.textContent = fact;
      return li;
    }),
  );
  facts.hidden = display.facts.length === 0;

  const links = $("status-links");
  const items: [string, string][] = [];
  if (outcome.kind === "entry") {
    items.push(["View verification details", `${API_BASE}/verify/${encodeURIComponent(outcome.entry.verification_id)}`]);
    items.push(["View manifest", `${API_BASE}/api/manifest/${encodeURIComponent(outcome.entry.domain)}`]);
  }
  if (domain) items.push(["Open in TrustTab →", `${API_BASE}/dashboard/open?domain=${encodeURIComponent(domain)}`]);
  links.replaceChildren(
    ...items.map(([label, href]) => {
      const a = document.createElement("a");
      a.textContent = label;
      a.href = href;
      a.target = "_blank";
      a.rel = "noreferrer";
      return a;
    }),
  );
  links.hidden = items.length === 0;
}

/**
 * AI Check, widget detection. Runs the collector in the active tab only when
 * the user opens this tab (`activeTab` + `scripting`), and matches the result
 * here in the popup. No network requests: nothing about the page leaves the
 * browser.
 */
async function checkWidgets(): Promise<WidgetCheckOutcome> {
  const result = (evidence: Parameters<typeof detectWidgets>[0]): WidgetCheckOutcome => ({
    kind: "result",
    detections: detectWidgets(evidence, WIDGET_SIGNATURES),
    providersChecked: WIDGET_SIGNATURES.length,
  });

  if (typeof chrome === "undefined" || !chrome.scripting?.executeScript) {
    // Development preview: `?widgetHosts=a.example,b.example` stands in for page evidence.
    const hosts = new URLSearchParams(location.search).get("widgetHosts");
    return hosts === null ? { kind: "preview" } : result({ hosts: hosts.split(","), matchedSelectors: [] });
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !/^https?:/.test(tab.url ?? "")) return { kind: "unavailable" };
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageEvidence,
      args: [selectorsFor(WIDGET_SIGNATURES)],
    });
    return injection?.result ? result(injection.result) : { kind: "unavailable" };
  } catch {
    // Chrome refuses injection into some pages (Web Store, other extensions, error pages).
    return { kind: "unavailable" };
  }
}

function renderWidgetCheck(outcome: WidgetCheckOutcome) {
  const display = describeWidgetCheck(outcome);
  const card = $("ai-card");
  card.dataset.state = outcome.kind === "result" && outcome.detections.length > 0 ? "found" : "clear";
  card.setAttribute("aria-busy", "false");
  $("ai-title").textContent = display.title;
  $("ai-summary").textContent = display.summary;

  const list = $("ai-detections");
  list.replaceChildren(
    ...display.items.map((item) => {
      const li = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = item.title;
      li.append(title);
      if (item.note) {
        const note = document.createElement("p");
        note.textContent = item.note;
        li.append(note);
      }
      const evidence = document.createElement("p");
      evidence.className = "evidence";
      evidence.textContent = `Found: ${item.evidence.join("; ")}`;
      li.append(evidence);
      return li;
    }),
  );
  list.hidden = display.items.length === 0;
}

/**
 * AI Check 2b, run only from the "Check this page's writing" button: reads
 * the page's main text in the active tab, then sends it to TrustTab. Nothing
 * is extracted or sent before the click.
 */
async function checkWriting(): Promise<TextEstimateOutcome> {
  let text: string;
  if (typeof chrome === "undefined" || !chrome.scripting?.executeScript) {
    // Development preview: `?pageText=` stands in for the page.
    text = new URLSearchParams(location.search).get("pageText") ?? "";
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !/^https?:/.test(tab.url ?? "")) return { kind: "cant_inspect" };
    try {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractMainText, args: [MAX_CHARS] });
      if (!injection?.result) return { kind: "cant_inspect" };
      text = injection.result.text;
    } catch {
      return { kind: "cant_inspect" };
    }
  }
  return requestTextEstimate(API_BASE, text);
}

function renderWriting(outcome: TextEstimateOutcome) {
  const display = describeTextEstimate(outcome);
  const box = $("writing-result");
  box.dataset.tone = display.tone;
  box.hidden = false;
  $("writing-title").textContent = display.title;
  const rationale = $("writing-rationale");
  // Model output: textContent only, and marked as the model's reasoning.
  rationale.textContent = display.rationale ? `Why: ${display.rationale}` : "";
  rationale.hidden = !display.rationale;
  $("writing-details").replaceChildren(
    ...display.details.map((detail) => {
      const li = document.createElement("li");
      li.textContent = detail;
      return li;
    }),
  );
}

function setupWritingCheck() {
  const button = $<HTMLButtonElement>("writing-button");
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      renderWriting(await checkWriting());
    } finally {
      button.disabled = false;
      button.textContent = "Check again";
    }
  });
}

let widgetCheckStarted = false;

function setupTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[role=tab]");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const other of tabs) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        $(other.getAttribute("aria-controls")!).hidden = !selected;
      }
      if (tab.id === "tab-ai" && !widgetCheckStarted) {
        widgetCheckStarted = true;
        void checkWidgets().then(renderWidgetCheck);
      }
    });
  }
}

async function main() {
  setupTabs();
  setupWritingCheck();
  $("issuer").textContent = new URL(API_BASE).host;

  const target = domainFromTabUrl(await activeTabUrl());
  if (!target.ok) {
    render(null, { kind: "not_applicable", reason: target.reason });
    return;
  }
  // Only shown when a lookup is actually sent.
  $("privacy-note").hidden = false;
  $("status-domain").textContent = target.domain;
  render(target.domain, await lookupDomain(API_BASE, target.domain));
}

void main();
