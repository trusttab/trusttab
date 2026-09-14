import { getPublicJwks } from "@/lib/manifest/signing";

/**
 * GET /.well-known/jwks.json — public keys (RFC 7517) for verifying manifest
 * signatures issued by this TrustTab instance. Match a manifest signature's
 * JWS `kid` header against `keys[].kid`.
 */
export function GET() {
  return Response.json(getPublicJwks(), {
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=3600",
    },
  });
}
