import { describeImageEstimate, type ImageEstimateOutcome } from "@/lib/ai-image/display";
import { describeTextEstimate, MAX_CHARS, type TextEstimateOutcome } from "@/lib/ai-text/display";
import { describeLookup, type LookupOutcome } from "@/lib/registry-display";

import { domainFromTabUrl, lookupDomain } from "./lookup";
import type { WorkerRequest } from "./c2pa-worker";
import {
  collectImageCandidates,
  fetchWithPermission,
  MAX_CANDIDATES,
  prepareEstimateJpeg,
  readImageBytes,
  requestImageEstimate,
  sniffImageFormat,
  type ImageBytes,
  type ImageCandidate,
} from "./image-check";
import { checkLookalike, describeLookalike } from "./lookalike";
import { describeProvenance, findUnsignedAiMetadata, type CredentialsResult } from "./provenance";
import { summarizeSafety, type SafetyFinding } from "./safety-badge";
import { collectRequestBlocks, findSensitiveRequest } from "./sensitive-request";
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
    // Development preview: `?widgetHosts=a.example,b.example` stands in for page
    // evidence, and the page's own address comes from `?url=`.
    const params = new URLSearchParams(location.search);
    const hosts = params.get("widgetHosts");
    let pageHost = "";
    try {
      pageHost = new URL(params.get("url") ?? "").hostname;
    } catch {
      pageHost = "";
    }
    return hosts === null ? { kind: "preview" } : result({ pageHost, hosts: hosts.split(","), matchedSelectors: [] });
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

// ---------------------------------------------------------------------------
// Concrete safety checks and the summary badge

const MAX_REQUEST_BLOCKS = 20;
const MAX_REQUEST_CHARS = 4000;

/**
 * Runs the deterministic checks when the AI Check tab is opened: a
 * sensitive-info request in the page's chat/form text, and a domain that
 * resembles a frequently spoofed brand. Both run entirely in the browser,
 * with no network calls and no model judgment.
 */
async function runSafetyChecks(pageHost: string, tabId?: number): Promise<SafetyFinding[]> {
  const findings: SafetyFinding[] = [];

  let blocks: string[] = [];
  if (tabId !== undefined) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: collectRequestBlocks,
        args: [selectorsFor(WIDGET_SIGNATURES), MAX_REQUEST_BLOCKS, MAX_REQUEST_CHARS],
      });
      blocks = injection?.result ?? [];
    } catch {
      blocks = [];
    }
  } else {
    // Development preview: `?requestText=` stands in for the page's chat/form text.
    const text = new URLSearchParams(location.search).get("requestText");
    blocks = text ? [text] : [];
  }

  const request = findSensitiveRequest(blocks);
  if (request) {
    findings.push({
      check: "sensitive-request",
      title: `This page's chat or form asks for: ${request.requested.join(", ")}`,
      details: [
        `Alongside urgency language: ${request.urgency.join(", ")}.`,
        `Found: “${request.quote}”`,
        `Legitimate support rarely asks for this unprompted. Check you're really dealing with ${pageHost || "this site"} before sharing anything.`,
      ],
    });
  }

  const lookalike = pageHost ? checkLookalike(pageHost) : null;
  if (lookalike) {
    findings.push({
      check: "domain-lookalike",
      title: describeLookalike(lookalike),
      details: ["Compared against a bundled list of frequently spoofed brands. A similar name is a similarity, not proof of anything by itself."],
    });
  }

  return findings;
}

function renderSafetyBadge(findings: SafetyFinding[]) {
  const summary = summarizeSafety(findings);
  const badge = $("safety-badge");
  badge.dataset.tier = summary.tier;
  badge.hidden = false;
  $("safety-title").textContent = summary.title;
  $("safety-summary").textContent = summary.summary;
  $("safety-findings").replaceChildren(
    ...summary.findings.map((finding) => {
      const li = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = finding.title;
      li.append(title);
      for (const detail of finding.details) {
        const p = document.createElement("p");
        // Page text, shown verbatim: textContent only.
        p.textContent = detail;
        if (detail.startsWith("Found:")) p.className = "safety-quote";
        li.append(p);
      }
      return li;
    }),
  );
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
  const evidence = $("writing-evidence");
  evidence.textContent = display.evidence.length ? `Quoted from the page: ${display.evidence.map((q) => `“${q}”`).join(", ")}` : "";
  evidence.hidden = display.evidence.length === 0;
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

// ---------------------------------------------------------------------------
// AI Check 2c: images

const inExtension = () => typeof chrome !== "undefined" && !!chrome.scripting?.executeScript;

const fillList = (id: string, items: string[]) => {
  const list = $(id);
  list.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
  list.hidden = items.length === 0;
};

let c2paWorker: Worker | undefined;
let trustFiles: Promise<WorkerRequest["trust"]> | undefined;

/** Reads Content Credentials in the extension's own worker; nothing leaves the browser. */
async function readCredentials(blob: Blob, format: string): Promise<CredentialsResult> {
  const text = (path: string) => fetch(path).then((r) => r.text());
  trustFiles ??= Promise.all([
    text("trust/c2pa-trust-list.pem"),
    text("trust/interim-anchors.pem"),
    text("trust/interim-allowed.sha256.txt"),
    text("trust/interim-store.cfg"),
  ]).then(([c2pa, interimAnchors, interimAllowed, interimConfig]) => ({ c2pa, interimAnchors, interimAllowed, interimConfig }));
  const trust = await trustFiles;
  c2paWorker ??= new Worker("c2pa-worker.js", { type: "module" });
  const worker = c2paWorker;
  return new Promise((resolve) => {
    worker.onmessage = (event: MessageEvent<CredentialsResult>) => resolve(event.data);
    worker.onerror = () => resolve({ kind: "error" });
    worker.postMessage({ blob, format, trust } satisfies WorkerRequest);
  });
}

let currentTabId: number | undefined;
let selectedBlob: Blob | undefined;
let checkToken = 0;

function renderProvenance(display: ReturnType<typeof describeProvenance>) {
  const card = $("provenance-card");
  card.dataset.tier = display.tier;
  $("provenance-chip").textContent = display.chip;
  $("provenance-title").textContent = display.title;
  fillList("provenance-statements", display.statements);
  fillList("provenance-details", display.details);
}

function renderImageEstimate(outcome: ImageEstimateOutcome) {
  const display = describeImageEstimate(outcome);
  const box = $("image-estimate-result");
  box.dataset.tone = display.tone;
  box.hidden = false;
  $("image-estimate-chip").hidden = display.tone !== "estimate";
  $("image-estimate-title").textContent = display.title;
  // Model output: textContent only.
  fillList("image-estimate-artifacts", display.artifacts.map((a) => `Model reports: ${a}`));
  fillList("image-estimate-details", display.details);
}

async function checkImage(candidate: ImageCandidate) {
  const token = ++checkToken;
  selectedBlob = undefined;
  $("image-result").hidden = false;
  $("image-permission").hidden = true;
  $("image-estimate").hidden = true;
  $("image-estimate-result").hidden = true;
  renderProvenance({ tier: "notice", chip: "Reading", title: "Reading this image's metadata…", statements: [], details: [], allowEstimate: false });

  let bytes: ImageBytes;
  if (inExtension() && currentTabId !== undefined) bytes = await readImageBytes(currentTabId, candidate.src);
  else bytes = await fetchWithPermission(candidate.src); // development preview
  if (token !== checkToken) return;

  if (bytes.kind === "needs_permission") {
    const host = new URL(bytes.origin.replace(/\/\*$/, "")).host;
    renderProvenance({ tier: "notice", chip: "Not checked", title: "Permission needed to read this image", statements: [], details: [], allowEstimate: false });
    $("image-permission-text").textContent =
      `This image is on ${host}, which doesn't let other sites read its files. Chrome will ask whether TrustTab may read data on ${host}; it's used only to read images you pick.`;
    const button = $<HTMLButtonElement>("image-permission-button");
    button.onclick = () => {
      // Called directly in the click handler: Chrome only shows the prompt for a user gesture.
      void chrome.permissions.request({ origins: [bytes.origin] }).then((granted) => {
        if (granted) void checkImage(candidate);
        else $("image-permission-text").textContent = "Permission wasn't granted, so this image can't be read.";
      });
    };
    $("image-permission").hidden = false;
    return;
  }
  if (bytes.kind !== "ok") {
    renderProvenance({
      tier: "notice",
      chip: "Not checked",
      title: bytes.kind === "too_large" ? "This image is too large to check" : "Couldn't read this image",
      statements: [],
      details: ["This says nothing about how the image was made."],
      allowEstimate: false,
    });
    return;
  }

  const data = new Uint8Array(await bytes.blob.arrayBuffer());
  const format = sniffImageFormat(data, bytes.blob.type);
  const credentials: CredentialsResult = format ? await readCredentials(bytes.blob, format) : { kind: "unsupported" };
  if (token !== checkToken) return;
  const display = describeProvenance(credentials, credentials.kind === "manifest" && credentials.state === "Trusted" ? [] : findUnsignedAiMetadata(data));
  renderProvenance(display);
  selectedBlob = bytes.blob;
  $("image-estimate").hidden = !display.allowEstimate;
}

function setupImageCheck() {
  const findButton = $<HTMLButtonElement>("images-button");
  findButton.addEventListener("click", async () => {
    const status = $("images-status");
    let candidates: ImageCandidate[] = [];
    if (inExtension()) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined || !/^https?:/.test(tab.url ?? "")) {
        status.textContent = "Chrome doesn't let extensions read this kind of page.";
        status.hidden = false;
        return;
      }
      currentTabId = tab.id;
      try {
        const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectImageCandidates, args: [MAX_CANDIDATES] });
        candidates = injection?.result ?? [];
      } catch {
        status.textContent = "Chrome doesn't let extensions read this page.";
        status.hidden = false;
        return;
      }
    } else {
      // Development preview: `?imageUrls=a,b` stands in for the page's images.
      candidates = (new URLSearchParams(location.search).get("imageUrls") ?? "").split(",").filter(Boolean).map((src) => ({ src, width: 0, height: 0, alt: "" }));
    }

    status.textContent = candidates.length
      ? `${candidates.length} image${candidates.length === 1 ? "" : "s"} found. Pick one to check.`
      : "No images of at least 200px found on this page.";
    status.hidden = false;
    const list = $("images-list");
    list.replaceChildren(
      ...candidates.map((candidate, i) => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-pressed", "false");
        const name = candidate.alt || decodeURIComponent(candidate.src.split(/[?#]/)[0].split("/").pop() || "").slice(0, 60) || `Image ${i + 1}`;
        button.title = candidate.width ? `${name} (${candidate.width}×${candidate.height})` : name;
        button.setAttribute("aria-label", `Check image: ${button.title}`);
        const img = document.createElement("img");
        img.src = candidate.src;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.loading = "lazy";
        button.append(img);
        button.addEventListener("click", () => {
          for (const other of list.querySelectorAll("button")) other.setAttribute("aria-pressed", String(other === button));
          void checkImage(candidate);
        });
        li.append(button);
        return li;
      }),
    );
    list.hidden = candidates.length === 0;
  });

  const estimateButton = $<HTMLButtonElement>("image-estimate-button");
  estimateButton.addEventListener("click", async () => {
    const blob = selectedBlob;
    if (!blob) return;
    estimateButton.disabled = true;
    estimateButton.textContent = "Checking…";
    try {
      const jpeg = await prepareEstimateJpeg(blob);
      renderImageEstimate(jpeg ? await requestImageEstimate(API_BASE, jpeg) : { kind: "unreadable" });
    } finally {
      estimateButton.disabled = false;
      estimateButton.textContent = "Ask again";
    }
  });
}

/** The active tab's host and id, or the preview's `?url=` host. */
async function currentPageHost(): Promise<{ host: string; tabId?: number }> {
  if (!inExtension()) {
    try {
      return { host: new URL(new URLSearchParams(location.search).get("url") ?? "").hostname };
    } catch {
      return { host: "" };
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !/^https?:/.test(tab.url ?? "")) return { host: "" };
  try {
    return { host: new URL(tab.url!).hostname, tabId: tab.id };
  } catch {
    return { host: "" };
  }
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
        void currentPageHost().then(async ({ host, tabId }) => renderSafetyBadge(await runSafetyChecks(host, tabId)));
      }
    });
  }
}

async function main() {
  setupTabs();
  setupWritingCheck();
  setupImageCheck();
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
