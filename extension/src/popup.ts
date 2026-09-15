import { describeLookup, type LookupOutcome } from "@/lib/registry-display";

import { domainFromTabUrl, lookupDomain } from "./lookup";

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

function setupTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>("[role=tab]");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      for (const other of tabs) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        $(other.getAttribute("aria-controls")!).hidden = !selected;
      }
    });
  }
}

async function main() {
  setupTabs();
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
