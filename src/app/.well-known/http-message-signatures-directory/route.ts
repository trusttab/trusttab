/**
 * TEMPORARY — remove after the /api/agent-check live test (2026-09-19).
 *
 * Web Bot Auth key directory for a throwaway test agent identity, so a real
 * signed request can be sent to this deployment and the agent-check diagnostic
 * proven end to end against a genuine directory fetch. The private half never
 * left the machine that generated it and was not committed.
 *
 * TrustTab is not an agent and must not advertise one: this file exists only
 * to prove the verification path against a live deployment, and is deleted in
 * the commit right after the test. Same process as the declared-intent live
 * test on 2026-09-18.
 */
const TEST_AGENT_KEYS = {
  keys: [
    {
      kty: "OKP",
      crv: "Ed25519",
      alg: "EdDSA",
      x: "0IBMJF_60fNJYu0PmTW2f18a4C4JdagUkpG96_PPx_E",
      kid: "6Jrys3KK4HKKLbbjrD2-99K-Ycwa9EQ6-wRZxM3tvQw",
      nbf: 1789877775,
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
