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
