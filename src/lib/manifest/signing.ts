import "server-only";

import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, type KeyObject } from "node:crypto";

import { canonicalize } from "./canonical-json";
import type { Ed25519Jwk } from "./signature-verify";
import type { Manifest, UnsignedManifest } from "./types";

/**
 * Manifest signing: Ed25519, packaged as a detached compact JWS.
 *
 *   signature = base64url(header) + ".." + base64url(Ed25519(signingInput))
 *   signingInput = base64url(header) + "." + base64url(JCS(manifest without site.signature))
 *
 * The payload segment is omitted from the stored string ("detached", RFC 7515
 * Appendix F) because the payload is the manifest itself. Verifiers rebuild it
 * by canonicalizing the manifest they received with `site.signature` removed,
 * then check the signature with the key whose `kid` appears in the header,
 * published at <issuer.url>/.well-known/jwks.json.
 *
 * The signature lives inside the JSON (not in HTTP headers), so a manifest
 * remains verifiable wherever it's copied or cached.
 *
 * This is the only module that loads the private signing key. Verification
 * lives in ./signature-verify.ts and needs only public keys, so code that must
 * never sign (the dashboard assistant) can verify without importing this file.
 */

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

let cachedKey: { privateKey: KeyObject; publicJwk: Ed25519Jwk } | null = null;

/**
 * Loads the issuer's signing key from TRUSTTAB_SIGNING_PRIVATE_KEY
 * (base64-encoded PKCS#8 DER). Generate one with `npm run keys:generate`.
 */
function getSigningKey() {
  if (cachedKey) return cachedKey;

  const encoded = process.env.TRUSTTAB_SIGNING_PRIVATE_KEY;
  if (!encoded) {
    throw new Error(
      "TRUSTTAB_SIGNING_PRIVATE_KEY is not set. Run `npm run keys:generate` and add the output to your environment.",
    );
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(encoded, "base64"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("TRUSTTAB_SIGNING_PRIVATE_KEY must be an Ed25519 key.");
  }

  const { x } = createPublicKey(privateKey).export({ format: "jwk" }) as { x: string };
  cachedKey = {
    privateKey,
    publicJwk: { kty: "OKP", crv: "Ed25519", x, kid: jwkThumbprint(x), alg: "EdDSA", use: "sig" },
  };
  return cachedKey;
}

/** RFC 7638 JWK thumbprint, used as the key ID. */
function jwkThumbprint(x: string): string {
  const members = canonicalize({ crv: "Ed25519", kty: "OKP", x });
  return createHash("sha256").update(members).digest("base64url");
}

/** Public keys to publish in the JWKS. (One key today; rotation adds more.) */
export function getPublicJwks(): { keys: Ed25519Jwk[] } {
  return { keys: [getSigningKey().publicJwk] };
}

export function signManifest(unsigned: UnsignedManifest): Manifest {
  const { privateKey, publicJwk } = getSigningKey();
  const header = b64url(JSON.stringify({ alg: "EdDSA", kid: publicJwk.kid }));
  const payload = b64url(canonicalize(unsigned));
  const signature = cryptoSign(null, Buffer.from(`${header}.${payload}`), privateKey);

  return {
    ...unsigned,
    site: { ...unsigned.site, signature: `${header}..${b64url(signature)}` },
  };
}
