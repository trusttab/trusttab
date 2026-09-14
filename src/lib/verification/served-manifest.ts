import "server-only";

import { verifyManifestSignature, type Ed25519Jwk } from "@/lib/manifest/signing";
import type { Manifest } from "@/lib/manifest/types";

/**
 * Checks 4 and 5 — evaluated against the manifest the site actually serves
 * at https://<domain>/.well-known/agent-trust.json, not against our database.
 *
 * Domain match is the #1 anti-spoofing check: copying a verified competitor's
 * manifest onto your own site must fail. We require that the served document:
 *   - declares `site.domain` equal to the domain it's served from,
 *   - carries this site's `issuer.verification_id`, and
 *   - has a valid signature from this issuer's keys (so it can't be edited).
 *
 * A stale-but-genuine copy (e.g. an older version saved as a static file)
 * passes domain match; if it's old enough, the expiry check catches it.
 */

export type ServedManifestVerdict = {
  domainMatch: { passed: boolean; message: string };
  expiry: { passed: boolean; message: string };
};

export function evaluateServedManifest(args: {
  body: string;
  domain: string;
  verificationId: string;
  jwks: { keys: Ed25519Jwk[] };
  now?: Date;
}): ServedManifestVerdict {
  const now = args.now ?? new Date();
  const notEvaluated = { passed: false, message: "Not evaluated: no valid manifest was served." };

  let served: Manifest;
  try {
    served = JSON.parse(args.body);
  } catch {
    return {
      domainMatch: { passed: false, message: "/.well-known/agent-trust.json did not return valid JSON." },
      expiry: notEvaluated,
    };
  }

  const servedDomain = served?.site?.domain;
  if (servedDomain !== args.domain) {
    return {
      domainMatch: {
        passed: false,
        message: `The served manifest declares domain "${String(servedDomain)}", but it is served from ${args.domain}.`,
      },
      expiry: notEvaluated,
    };
  }
  if (served.issuer?.verification_id !== args.verificationId) {
    return {
      domainMatch: { passed: false, message: "The served manifest belongs to a different TrustTab registration." },
      expiry: notEvaluated,
    };
  }
  if (!verifyManifestSignature(served, args.jwks)) {
    return {
      domainMatch: { passed: false, message: "The served manifest's signature is invalid (it was modified or signed by another issuer)." },
      expiry: notEvaluated,
    };
  }

  const expiresAt = new Date(served.site.expires_at);
  return {
    domainMatch: { passed: true, message: `Served manifest is signed for ${args.domain}.` },
    expiry:
      expiresAt.getTime() > now.getTime()
        ? { passed: true, message: `Served manifest is valid until ${expiresAt.toISOString()}.` }
        : { passed: false, message: `Served manifest expired at ${expiresAt.toISOString()}. Serve the live manifest instead of a saved copy.` },
  };
}
