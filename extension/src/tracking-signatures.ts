/**
 * AI Check, Addition 7: known analytics, session-recording and fingerprinting
 * scripts.
 *
 * Same shape and same discipline as the widget signatures: exact host matching
 * against an explicit list, reported as fact, no judgment. This is the only
 * place these are defined; append an entry to extend.
 *
 * **Informational only — this never feeds the summary badge.** These scripts
 * run on the large majority of commercial websites. Treating them as a concern
 * would make nearly every site "something to review", which would empty the
 * badge of meaning. The finding is "this page loads tracking from X", not
 * "this page is doing something wrong".
 *
 * ## The shared-host rule, learned the hard way
 *
 * 2a's first pass produced false positives from vendor hosts that also serve
 * unrelated files (`static.zdassets.com`, `js.usemessages.com`). The same trap
 * is worse here, and one case deserves naming:
 *
 * **Google Tag Manager is a container, not a tracker.** `googletagmanager.com`
 * serves GTM, and GTM can load anything or nothing. Its presence means a tag
 * manager is installed — it does *not* mean Google Analytics is running, and
 * this list must not infer one from the other. GA is matched on its own hosts.
 * (`googletagmanager.com` also serves gtag.js for GA4, which is why the GTM
 * entry says "tag manager or Google tag" rather than naming a product.)
 *
 * Widget vendors that also sell analytics (HubSpot, Intercom) are deliberately
 * left out: they are already reported by the widget check, and listing them
 * twice would show one installation as two findings.
 */

export type TrackingKind =
  /** Page/event analytics. */
  | "analytics"
  /** Records sessions, replays what a visitor did. */
  | "session_recording"
  /** Builds a device or browser fingerprint. */
  | "fingerprinting"
  /** A container that can load other tags; says nothing about what it loads. */
  | "tag_manager";

export type TrackingSignature = {
  id: string;
  name: string;
  vendor: string;
  kind: TrackingKind;
  /** Hosts the script loads from. A host matches itself and any subdomain. */
  hosts: string[];
  /**
   * CSS selectors for the script tag itself, for libraries delivered from a
   * shared CDN where the host says nothing. Matched on the path, never the
   * host: listing `unpkg.com` would flag every site loading any npm package.
   */
  selectors?: string[];
  /** Shown with the finding when the plain name would overstate what was found. */
  note?: string;
};

export const TRACKING_SIGNATURES: TrackingSignature[] = [
  {
    id: "google-tag",
    name: "Google tag manager or Google tag",
    vendor: "Google",
    kind: "tag_manager",
    hosts: ["googletagmanager.com"],
    note: "A container that loads other tags. What it loads isn't visible from the page, so this doesn't show which analytics, if any, are running.",
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    vendor: "Google",
    kind: "analytics",
    hosts: ["google-analytics.com", "analytics.google.com", "ssl.google-analytics.com"],
  },
  { id: "meta-pixel", name: "Meta Pixel", vendor: "Meta", kind: "analytics", hosts: ["connect.facebook.net"] },
  { id: "tiktok-pixel", name: "TikTok Pixel", vendor: "TikTok", kind: "analytics", hosts: ["analytics.tiktok.com"] },
  { id: "linkedin-insight", name: "LinkedIn Insight Tag", vendor: "LinkedIn", kind: "analytics", hosts: ["snap.licdn.com"] },
  { id: "x-pixel", name: "X (Twitter) pixel", vendor: "X", kind: "analytics", hosts: ["static.ads-twitter.com", "analytics.twitter.com"] },

  { id: "hotjar", name: "Hotjar", vendor: "Hotjar", kind: "session_recording", hosts: ["static.hotjar.com", "script.hotjar.com"] },
  { id: "fullstory", name: "FullStory", vendor: "FullStory", kind: "session_recording", hosts: ["fullstory.com", "edge.fullstory.com"] },
  { id: "logrocket", name: "LogRocket", vendor: "LogRocket", kind: "session_recording", hosts: ["cdn.logrocket.io", "cdn.lr-ingest.io"] },
  { id: "microsoft-clarity", name: "Microsoft Clarity", vendor: "Microsoft", kind: "session_recording", hosts: ["clarity.ms"] },
  { id: "mouseflow", name: "Mouseflow", vendor: "Mouseflow", kind: "session_recording", hosts: ["cdn.mouseflow.com"] },
  { id: "smartlook", name: "Smartlook", vendor: "Smartlook", kind: "session_recording", hosts: ["web-sdk.smartlook.com"] },

  /**
   * An open-source recorder, not a vendor service, usually loaded from a
   * generic CDN — found on leasetab.com at
   * `unpkg.com/rrweb@2.0.0-alpha.20/dist/rrweb.umd.cjs`. Matched on the path
   * for exactly that reason: the host is shared with all of npm.
   */
  {
    id: "rrweb",
    name: "rrweb session recorder",
    vendor: "rrweb (open source)",
    kind: "session_recording",
    hosts: [],
    selectors: ['script[src*="/rrweb@"]', 'script[src*="/rrweb."]', 'script[src*="/rrweb/"]'],
    note: "An open-source recording library rather than a hosted service, so who receives the recording isn't visible from the page.",
  },

  { id: "fingerprintjs", name: "FingerprintJS", vendor: "FingerprintJS", kind: "fingerprinting", hosts: ["fpjs.io", "fpnpmcdn.net", "api.fpjs.io"] },
  { id: "threatmetrix", name: "ThreatMetrix", vendor: "LexisNexis", kind: "fingerprinting", hosts: ["online-metrix.net"] },

  { id: "segment", name: "Segment", vendor: "Twilio", kind: "analytics", hosts: ["cdn.segment.com"] },
  { id: "mixpanel", name: "Mixpanel", vendor: "Mixpanel", kind: "analytics", hosts: ["cdn.mxpnl.com"] },
  { id: "amplitude", name: "Amplitude", vendor: "Amplitude", kind: "analytics", hosts: ["cdn.amplitude.com", "api.amplitude.com"] },
  { id: "posthog", name: "PostHog", vendor: "PostHog", kind: "analytics", hosts: ["app.posthog.com", "us.i.posthog.com", "eu.i.posthog.com"] },
  { id: "plausible", name: "Plausible", vendor: "Plausible", kind: "analytics", hosts: ["plausible.io"] },
  { id: "matomo", name: "Matomo", vendor: "Matomo", kind: "analytics", hosts: ["cdn.matomo.cloud"] },
];

/** Shown alongside any result, so silence is never read as "no tracking here". */
export const TRACKING_CAVEAT =
  "This matches a fixed list of well-known scripts by the host they load from, or by the script's own path where a shared CDN makes the host meaningless. Finding nothing doesn't mean a page isn't tracking you — only that nothing on this list was loaded.";

/** Shown whenever any tracking is reported, so the finding isn't read as a warning. */
export const TRACKING_CONTEXT =
  "Most commercial websites load scripts like these. This is here so you can see what a page loads, not because it's a problem.";
