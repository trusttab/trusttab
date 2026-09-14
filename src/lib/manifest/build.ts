import "server-only";

import { randomBytes } from "node:crypto";

import type { ManifestInput, UnsignedManifest } from "./types";

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
 * Assembles the unsigned manifest for a site from the owner's input.
 *
 * Fields the owner doesn't control are set here:
 * - `site.verified_at` is null and `content_scan.status` is "pending" — a
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
    // before signing (validation would reject them anyway).
    endpoints: input.endpoints.map((e) => ({
      path: e.path,
      method: e.method,
      purpose: e.purpose,
      schema: e.schema,
      agent_safe: e.agent_safe,
      requires_captcha: e.requires_captcha,
    })),
  };
}
