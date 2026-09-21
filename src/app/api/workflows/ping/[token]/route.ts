import { after } from "next/server";

import { recordPing, workflowForPingToken } from "@/lib/workflows/store";

/**
 * The heartbeat endpoint. A monitored workflow calls this on each run.
 *
 *   GET  /api/workflows/ping/<token>
 *   POST /api/workflows/ping/<token>
 *
 * Both methods, because the platforms this has to work with differ in what
 * their HTTP step sends by default, and a monitoring hook that fails because
 * someone picked the wrong verb is a bad hook.
 *
 * Deliberately minimal:
 *
 * - **Nothing about the caller is recorded.** No IP, no user agent, no body,
 *   no query string. A ping is the fact that one arrived and when. The body is
 *   never read at all, so a workflow can post whatever it likes.
 * - **It answers before doing the work.** The write happens in `after()`, so a
 *   slow database never delays a customer's workflow. This endpoint sits inside
 *   someone else's automation; it must not be a reason their run takes longer.
 * - **An unknown token gets the same 404 as a deleted workflow**, so the
 *   endpoint can't be used to discover which workflow ids exist.
 * - **No caching, ever.** A cached ping response would mean a run that never
 *   reached us looking like it did.
 */

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } as const;

async function handle(_request: Request, ctx: RouteContext<"/api/workflows/ping/[token]">) {
  const { token } = await ctx.params;
  const workflow = await workflowForPingToken(token);
  if (!workflow) {
    return new Response(JSON.stringify({ error: "Unknown ping URL." }), { status: 404, headers: HEADERS });
  }

  const at = new Date();
  after(() => recordPing(workflow.id, at).catch(() => {}));

  return new Response(JSON.stringify({ ok: true, workflow: workflow.name, received_at: at.toISOString() }), {
    status: 200,
    headers: HEADERS,
  });
}

export const GET = handle;
export const POST = handle;
