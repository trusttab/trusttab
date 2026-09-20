import type { WebBotAuthResult } from "./web-bot-auth";

/**
 * The body of the agent operator's self-service diagnostic
 * (`GET /api/agent-check`), separated from the route so both branches can be
 * tested: the failure paths are easy to exercise over HTTP, but a successful
 * verification needs a real signature over a published key directory, which
 * only the library's test seam can produce locally.
 *
 * Every response carries the same disclaimer. This endpoint reports what a
 * signature check found; it issues nothing, and must never be mistakable for a
 * credential (CLAUDE.md, "What TrustTab is NOT").
 */

export const AGENT_CHECK_NOTE_FAILED =
  "TrustTab verifies signatures against keys you publish. It does not issue identity.";

export const AGENT_CHECK_NOTE_VERIFIED =
  "TrustTab verifies signatures against keys you publish. It does not issue identity, and this says nothing about how your agent behaves.";

/** Plain-language explanation for each failure, so the operator can act on it. */
export const AGENT_CHECK_REASONS: Record<
  Extract<WebBotAuthResult, { ok: false }>["reason"],
  { summary: string; fix: string }
> = {
  "not-signed": {
    summary: "No HTTP message signature was present on this request.",
    fix: "Send `Signature` and `Signature-Input` headers, per RFC 9421.",
  },
  "no-agent": {
    summary: "No usable `Signature-Agent` header was present.",
    fix: "Send `Signature-Agent` as an https URL pointing at the host serving your key directory.",
  },
  "directory-unavailable": {
    summary: "Your key directory could not be fetched, or held no usable keys.",
    fix: "Serve /.well-known/http-message-signatures-directory over https from a public address, as JSON, with at least one Ed25519 key. Only Ed25519 is supported.",
  },
  unverified: {
    summary: "A signature was present, but it did not verify against the keys your directory publishes.",
    fix: "Check that the `keyid` names a key in your directory, that the signature has not expired, and that it covers @authority for this host.",
  },
  budget: {
    summary: "TrustTab's directory-fetch budget for this instance is exhausted, so your directory was not fetched.",
    fix: "This is a limit on our side, not a problem with your setup. Try again in a few minutes.",
  },
};

export function agentCheckBody(result: WebBotAuthResult): Record<string, unknown> {
  if (!result.ok) {
    const reason = AGENT_CHECK_REASONS[result.reason];
    return {
      verified: false,
      reason: result.reason,
      summary: reason.summary,
      what_to_check: reason.fix,
      note: AGENT_CHECK_NOTE_FAILED,
    };
  }

  return {
    verified: true,
    identity: result.identity,
    keyid: result.keyid,
    signature_expires: result.expires.toISOString(),
    /** Only these are tamper-evident; anything else can be appended to a valid signature. */
    covered_components: result.components,
    declared_intent: result.declaration
      ? { purposes: result.declaration.purposes, scopes: result.declaration.scopes }
      : null,
    summary: `This request verified as ${result.identity}. A site running TrustTab would show it as a verified agent.`,
    note: AGENT_CHECK_NOTE_VERIFIED,
  };
}
