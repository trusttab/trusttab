/**
 * Manifest signature verification. Needs only public keys (a JWKS), never the
 * private signing key, so it is safe to use from code that must not be able to
 * sign (see src/lib/assistant). Signing lives in ./signing.ts.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

import { canonicalize } from "./canonical-json";
import type { Manifest } from "./types";

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

export type Ed25519Jwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  alg: "EdDSA";
  use: "sig";
};

/**
 * Verifies a manifest's signature against a set of public keys. Returns false
 * for any malformed input rather than throwing.
 */
export function verifyManifestSignature(manifest: Manifest, jwks: { keys: Ed25519Jwk[] }): boolean {
  try {
    const [header, empty, sig] = manifest.site.signature.split(".");
    if (!header || empty !== "" || !sig) return false;

    const { alg, kid } = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const jwk = jwks.keys.find((k) => k.kid === kid);
    if (alg !== "EdDSA" || !jwk) return false;

    const { signature: _omit, ...site } = manifest.site;
    void _omit;
    const payload = b64url(canonicalize({ ...manifest, site }));
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
    return cryptoVerify(null, Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}

/**
 * Verifies a detached JWS produced by `signDetached` over `payload`. The same
 * check a customer's edge performs on an enforcement feed, kept here so the
 * server can prove the two agree.
 */
export function verifyDetached(payload: unknown, signature: string, jwks: { keys: Ed25519Jwk[] }): boolean {
  return verifyDetachedOverString(canonicalize(payload), signature, jwks);
}

/** Verifies a detached JWS over exact bytes: what a customer's edge does with a feed. */
export function verifyDetachedOverString(canonical: string, signature: string, jwks: { keys: Ed25519Jwk[] }): boolean {
  try {
    const [header, empty, sig] = signature.split(".");
    if (!header || empty !== "" || !sig) return false;

    const { alg, kid } = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const jwk = jwks.keys.find((k) => k.kid === kid);
    if (alg !== "EdDSA" || !jwk) return false;

    const body = b64url(canonical);
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" });
    return cryptoVerify(null, Buffer.from(`${header}.${body}`), publicKey, Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}
