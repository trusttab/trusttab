import { getApiUser, jsonError } from "@/lib/api";
import { sameOriginBrowserRequestError } from "@/lib/same-origin";
import { createWorkflow, deleteWorkflow } from "@/lib/workflows/store";

/**
 * Creating and deleting monitored workflows. Dashboard-only: a same-origin
 * browser request from a signed-in owner, with every query scoped by user, so
 * another account's workflow is simply not found rather than refused.
 *
 * The ping token is returned exactly once, on creation. Only its hash is
 * stored, so it can't be shown again — the same handling as the collector
 * token, for the same reason: anyone holding a ping URL can make a workflow
 * look alive.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function POST(request: Request) {
  const sameOrigin = sameOriginBrowserRequestError(request);
  if (sameOrigin) return jsonError(403, sameOrigin);

  const user = await getApiUser();
  if (!user) return jsonError(401, "Sign in to monitor a workflow.");

  const body = (await request.json().catch(() => ({}))) as { name?: unknown; cadence?: unknown };
  const result = await createWorkflow(user.id, body.name, body.cadence);
  if (!result.ok) return jsonError(400, result.error);

  return json(201, { id: result.id, token: result.token });
}

export async function DELETE(request: Request) {
  const sameOrigin = sameOriginBrowserRequestError(request);
  if (sameOrigin) return jsonError(403, sameOrigin);

  const user = await getApiUser();
  if (!user) return jsonError(401, "Sign in first.");

  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string") return jsonError(400, "Which workflow?");

  const removed = await deleteWorkflow(user.id, body.id);
  return removed ? json(200, { deleted: true }) : jsonError(404, "Not found.");
}
