/**
 * Wording for the agent-traffic panel. Browser-safe and pure, so the labels
 * are unit tested.
 *
 * The two tiers must not read alike: a verified agent is a cryptographic
 * fact, a likely-automated match is an estimate from forgeable signals. And
 * neither direction ever claims the opposite — an unsigned request is not
 * evidence of a human, which is why there is no "human traffic" figure.
 */

import type { AgentTier } from "./classify";

export const TIER_LABELS: Record<AgentTier, string> = {
  verified: "Verified agents",
  likely_automated: "Likely automated (estimate)",
  trusttab: "TrustTab's own checks",
  unclassified: "Unclassified",
};

export const TIER_NOTES: Record<AgentTier, string> = {
  verified:
    "These requests carried a valid signature, checked against keys published by the agent's own domain. Signature coverage across the industry is still partial, so most agent traffic is unsigned today: no signature is not evidence of anything.",
  likely_automated:
    "Matched by user agent or by an IP range the operator publishes. Both can be wrong: user agents are self-reported, and the same networks carry uptime monitors, security scanners and ordinary people on VPNs.",
  trusttab: "TrustTab's own fetches while verifying this site, shown separately so they aren't counted as visitors.",
  unclassified: "None of the checks above matched. This says nothing about whether the visitor was a person or a program.",
};

export const REGISTRY_SCOPE_NOTE =
  "This covers requests to TrustTab's own endpoints for this site — its manifest and registry lookups — not visits to the site itself.";

export const SITE_SCOPE_NOTE = "This covers requests to your own pages, as reported by the collector you installed.";

/** Shown before anyone turns site-wide collection on, so the choice is informed. */
export const COLLECTION_DISCLOSURE = [
  "This is a bigger scope than the traffic above: it covers every request to your site, not just TrustTab lookups.",
  "Each request your collector reports sends the URL, the method, the visitor's IP and four headers (user agent and the three signature headers). No cookies, query strings, form fields or page content are sent.",
  "TrustTab uses the IP in memory to match published agent ranges, then stores it coarsened (IPv4 /24, IPv6 /48). Rows are deleted after 30 days.",
  "Logging visitor data can carry obligations of its own (GDPR and similar). Check what your privacy notice says before turning this on.",
];
