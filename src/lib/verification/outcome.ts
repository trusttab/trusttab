import type { ManifestEndpoint, VerificationStatus } from "@/lib/manifest/types";

import type { CheckResult } from "./types";

export type OutcomeSummary = {
  status: VerificationStatus;
  /** Who vouches for each endpoint, in manifest order. */
  endpointVerifiedBy: ManifestEndpoint["verified_by"][];
};

/**
 * Decides what a verification run earns. Pure, so the rules are easy to test.
 *
 * - "verified": every automated check passed.
 * - "self_declared": every check except endpoint match passed, and each
 *   endpoint either passed automatically or is self-attested by the owner
 *   (the engine only allows attestation to cover a form it couldn't see on a
 *   page that loaded; see engine.ts). At least one endpoint is self-declared.
 * - "unverified": anything else.
 *
 * Self-declared is deliberately a different outcome, never a lesser form of
 * "verified": `site.verified_at` stays null and every public surface labels it.
 */
export function summarizeOutcome(checks: CheckResult[]): OutcomeSummary {
  const endpointCheck = checks.find((c) => c.id === "endpoint_match");
  if (!endpointCheck) throw new Error("endpoint_match check missing");

  const endpointVerifiedBy = endpointCheck.details.map((d) =>
    d.passed ? ("issuer" as const) : d.selfDeclared ? ("owner" as const) : null,
  );

  if (checks.every((c) => c.passed)) return { status: "verified", endpointVerifiedBy };

  const othersPassed = checks.filter((c) => c !== endpointCheck).every((c) => c.passed);
  const allEndpointsVouched = endpointVerifiedBy.every((v) => v !== null);
  if (othersPassed && allEndpointsVouched && endpointVerifiedBy.includes("owner")) {
    return { status: "self_declared", endpointVerifiedBy };
  }
  return { status: "unverified", endpointVerifiedBy };
}
