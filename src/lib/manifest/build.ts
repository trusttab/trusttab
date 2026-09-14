import "server-only";

import { randomBytes } from "node:crypto";

import type { Manifest, ManifestEndpoint, ManifestInput, UnsignedManifest, VerificationStatus } from "./types";

/** How long a signed manifest stays valid before it must be re-issued. */
export const MANIFEST_TTL_DAYS = 30;

/**
 * Issuer identity comes from the environment, never from code: a self-hosted
 * TrustTab instance is a different issuer with its own name, URL and keys.
 */
export function getIssuer(): { name: string; url: string } {
  const name = process.env.TRUSTTAB_ISSUER_NAME;
  const url = process.env.TRUSTTAB_ISSUER_URL?.replace(/\/+$/, "");
  if (!name || !url) {
    throw new Error("TRUSTTAB_ISSUER_NAME and TRUSTTAB_ISSUER_URL must be set (see .env.example).");
  }
  return { name, url };
}

/** `tt_` + 12 lowercase base-32 characters (60 bits). Stable per site. */
export function generateVerificationId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = randomBytes(12);
  return `tt_${Array.from(bytes, (b) => alphabet[b % 32]).join("")}`;
}

/**
 * Re-issues an existing manifest after a verification run: same declarations,
 * new verification state, fresh expiry, current issuer identity. The caller
 * signs the result.
 */
export function reissueManifest(
  previous: Manifest,
  outcome: {
    status: VerificationStatus;
    /** Per endpoint, in manifest order. */
    endpointVerifiedBy: ManifestEndpoint["verified_by"][];
    scanStatus: "passed" | "failed" | "pending";
    now?: Date;
  },
): UnsignedManifest {
  const now = outcome.now ?? new Date();
  return {
    version: previous.version,
    issuer: { ...getIssuer(), verification_id: previous.issuer.verification_id },
    site: {
      domain: previous.site.domain,
      verification_status: outcome.status,
      verified_at: outcome.status === "verified" ? now.toISOString() : null,
      expires_at: new Date(now.getTime() + MANIFEST_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    },
    policy: {
      ...previous.policy,
      content_scan: { last_scanned: now.toISOString(), status: outcome.scanStatus },
    },
    endpoints: previous.endpoints.map((e, i) => ({
      ...toEndpoint(e),
      verified_by: outcome.endpointVerifiedBy[i] ?? null,
    })),
  };
}

/**
 * Copies exactly the schema's endpoint fields. Drops stray keys, and gives
 * manifests signed before self-attestation existed `self_attested: false`.
 */
function toEndpoint(e: Partial<ManifestEndpoint>): Omit<ManifestEndpoint, "verified_by"> {
  return {
    path: e.path!,
    method: e.method!,
    purpose: e.purpose!,
    schema: e.schema!,
    agent_safe: e.agent_safe!,
    requires_captcha: e.requires_captcha!,
    self_attested: e.self_attested === true,
  };
}

/**
 * Assembles the unsigned manifest for a site from the owner's input.
 *
 * Fields the owner doesn't control are set here:
 * - `verification_status` is "unverified", `site.verified_at` is null and
 *   `content_scan.status` is "pending" — a
 *   freshly published manifest has been schema-checked and signed, but the
 *   verification checks (endpoint match, injection scan) haven't run yet.
 *   The verification engine re-issues the manifest when they pass.
 * - `expires_at` is MANIFEST_TTL_DAYS from now.
 */
export function buildManifest(args: {
  domain: string;
  verificationId: string;
  input: ManifestInput;
  now?: Date;
}): UnsignedManifest {
  const now = args.now ?? new Date();
  const expiresAt = new Date(now.getTime() + MANIFEST_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { input } = args;

  return {
    version: "1.0",
    issuer: { ...getIssuer(), verification_id: args.verificationId },
    site: {
      domain: args.domain,
      verification_status: "unverified",
      verified_at: null,
      expires_at: expiresAt.toISOString(),
    },
    policy: {
      // Validation rejects anything but `true`; passing the input through
      // (rather than hardcoding true) is what makes the pledge meaningful.
      no_prompt_injection_pledge: input.no_prompt_injection_pledge as true,
      agent_rate_limit: {
        requests_per_minute: input.agent_rate_limit.requests_per_minute,
        captcha_exempt: input.agent_rate_limit.captcha_exempt,
      },
      content_scan: { last_scanned: null, status: "pending" },
    },
    // Rebuild each endpoint explicitly so stray client-side keys are dropped
    // before signing (validation would reject them anyway). Nothing has been
    // checked yet, so no endpoint is vouched for.
    endpoints: input.endpoints.map((e) => ({ ...toEndpoint(e), verified_by: null })),
  };
}
