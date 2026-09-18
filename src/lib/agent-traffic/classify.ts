import "server-only";

import { matchAgentSignature } from "./agents";
import type { IntentDeclaration } from "./intent";
import { matchAgentRange } from "./ip-match";
import { verifyWebBotAuth, type VerifyOptions } from "./web-bot-auth";

/**
 * Classifies one inbound request. Two tiers, deliberately unequal in strength:
 *
 * - "verified": a valid Web Bot Auth signature. The identity is known
 *   cryptographically, so the dashboard states it as fact.
 * - "likely_automated": a known agent user agent, or an IP inside a range the
 *   operator publishes for its crawlers. Both are estimates: user agents are
 *   self-reported, and shared infrastructure carries non-agent traffic too.
 * - "owner_identified": matched a signal the site's owner registered for their
 *   own agent (see owner-agents.ts). Applied by the recorders, which know
 *   which site a request was for; a verified signature always outranks it.
 *
 * Nothing here ever concludes "this was a human". An unclassified request is
 * just one none of these signals matched.
 */

export type AgentTier = "verified" | "likely_automated" | "owner_identified" | "trusttab" | "unclassified";

export type AgentClassification = {
  tier: AgentTier;
  /** Present only for verified agents that signed a declaration (see intent.ts). */
  declaration?: IntentDeclaration | null;
  /** Who it is, when known: a signed identity, or the operator's name for a heuristic match. */
  identity: string | null;
  /** The evidence, in plain words, for the dashboard to show. */
  signal: string | null;
};

const MAX_SIGNAL_CHARS = 200;

export async function classifyRequest(request: Request, ip: string | null, options: VerifyOptions = {}): Promise<AgentClassification> {
  const userAgent = request.headers.get("user-agent");
  const signature = matchAgentSignature(userAgent);

  // TrustTab's own verification fetches, so a site's checks aren't counted as visitors.
  if (signature?.kind === "trusttab") {
    return { tier: "trusttab", identity: "TrustTab", signal: "TrustTab's own verification fetch" };
  }

  const verified = await verifyWebBotAuth(request, options);
  if (verified.ok) {
    return {
      tier: "verified",
      identity: verified.identity,
      signal: `signed request, verified against ${new URL(verified.identity).host}'s published keys`,
      declaration: verified.declaration,
    };
  }

  const range = ip ? matchAgentRange(ip) : null;
  if (signature || range) {
    const signals = [
      signature ? `user agent says ${signature.name}` : null,
      range ? `IP is in ${range.operator}'s published ${range.product} range` : null,
    ].filter(Boolean);
    return {
      tier: "likely_automated",
      identity: signature ? `${signature.name} (${signature.operator})` : range!.operator,
      signal: signals.join("; ").slice(0, MAX_SIGNAL_CHARS),
    };
  }

  // A signature that didn't verify is worth recording as what it is, and nothing more.
  if (verified.reason === "unverified" || verified.reason === "directory-unavailable") {
    return { tier: "unclassified", identity: null, signal: "a signature was present but could not be verified" };
  }
  return { tier: "unclassified", identity: null, signal: null };
}
