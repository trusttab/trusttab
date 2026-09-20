import { agentCheckBody } from "@/lib/agent-traffic/agent-check";
import { verifyWebBotAuth } from "@/lib/agent-traffic/web-bot-auth";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/agent-check — an agent operator's self-service diagnostic.
 *
 * Send a signed request and this reports exactly what TrustTab saw: whether
 * the Web Bot Auth signature verified, which identity it resolved to, which
 * components the signature actually covered, and why it failed if it did. It
 * is the same verification path a real site's traffic goes through, so a
 * "verified" here means a "verified" there.
 *
 * What it deliberately is not: this issues nothing. There is no credential, no
 * token, no account and no record — TrustTab checks a signature against keys
 * the operator publishes themselves, exactly as any other party could. A pass
 * says the signature checked out on this request. It says nothing about how
 * the agent behaves.
 *
 * Nothing is stored: no traffic-log row, and no identity retained. A failure
 * is still a 200 — the check ran and has an answer, which is not an HTTP error
 * — so operators can script against it without treating 4xx as a verdict.
 *
 * The body is built by `agentCheckBody` so both branches are unit-tested; a
 * successful verification can't be produced over real HTTP in a local test.
 */

const HEADERS = {
  // Per-request and caller-specific, so no shared cache may hold it.
  "cache-control": "private, no-store",
  "content-type": "application/json",
} as const;

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "api", HEADERS);
  if (limited) return limited;

  const result = await verifyWebBotAuth(request);
  return Response.json(agentCheckBody(result), { headers: HEADERS });
}
