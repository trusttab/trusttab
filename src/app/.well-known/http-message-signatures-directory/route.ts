/**
 * TEMPORARY — remove after the declared-intent live test (2026-09-18).
 *
 * Web Bot Auth key directory for a throwaway test agent identity, so a real
 * signed request can be sent to this deployment and verified end to end. The
 * private half never left the machine that generated it and was not
 * committed.
 *
 * TrustTab is not an agent and must not advertise one: this file exists only
 * to prove the verification path against a live deployment, and is deleted in
 * the commit right after the test.
 */
const TEST_AGENT_KEYS = {
  keys: [
    {
      kty: "OKP",
      crv: "Ed25519",
      alg: "EdDSA",
      x: "p4lt1dhWNs4wTHM95pN-YBibrjg0TPeLyVXocvfmkDk",
      kid: "dovakmUfZvis1VFJ5YRlCLpu9bd_qH4H85A-zHj6j8w",
      nbf: 1789000000,
    },
  ],
};

export function GET() {
  return Response.json(TEST_AGENT_KEYS, {
    headers: {
      "content-type": "application/http-message-signatures-directory+json",
      "cache-control": "no-store",
    },
  });
}
