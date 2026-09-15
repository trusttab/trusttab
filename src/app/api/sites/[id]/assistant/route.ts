import Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { sites } from "@/db/schema";
import { getApiUser, isUuid, jsonError } from "@/lib/api";
import { DEFAULT_ASSISTANT_MODEL, runAssistant, type ChatTurn } from "@/lib/assistant/run";
import type { AssistantEvent } from "@/lib/assistant/tools";
import { consumeRateLimit } from "@/lib/rate-limit";

// A turn can include a site crawl and a preview check run.
export const maxDuration = 120;

const MAX_TURNS = 20;
const MAX_TURN_CHARS = 8000;
/** Messages per user per window, to bound model spend. */
const USER_LIMIT = { limit: 30, windowSeconds: 600 };

/**
 * POST /api/sites/:id/assistant — one message to the dashboard assistant for
 * this site. Body: `{ messages: [{ role: "user" | "assistant", content }] }`
 * (the conversation so far, ending with the owner's new message; chat history
 * is not stored server-side). Responds with newline-delimited JSON events:
 * text deltas, tool progress, draft changes and claim proposals.
 *
 * The assistant can only act through its tool allowlist (src/lib/assistant/
 * tools.ts), which cannot publish or sign. See src/lib/publish-gate.ts.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/sites/[id]/assistant">) {
  if (!process.env.ANTHROPIC_API_KEY) return jsonError(503, "The assistant isn't configured on this instance.");

  const user = await getApiUser();
  if (!user) return jsonError(401, "Sign in first.");

  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "Site not found.");
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, id), eq(sites.userId, user.id)));
  if (!site) return jsonError(404, "Site not found.");

  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  const history = parseHistory(body?.messages);
  if (!history) return jsonError(400, "Expected { messages: [...] } ending with a user message.");

  const { allowed, retryAfter } = await consumeRateLimit(`assistant:${user.id}`, USER_LIMIT.limit, USER_LIMIT.windowSeconds);
  if (!allowed) return jsonError(429, `You've sent a lot of messages. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AssistantEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        await runAssistant({
          client: new Anthropic(),
          model: process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL,
          ctx: { userId: user.id, siteId: site.id },
          domain: site.domain,
          history,
          emit,
          signal: request.signal,
        });
        emit({ type: "done" });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) {
          emit({ type: "error", message: "The assistant is busy right now. Please try again in a minute." });
        } else if (err instanceof Anthropic.APIError) {
          console.error("[assistant] model API error", err.status, err.message);
          emit({ type: "error", message: "The assistant couldn't reach the AI service. Please try again." });
        } else if (!request.signal.aborted) {
          console.error("[assistant] failed", err);
          emit({ type: "error", message: "Something went wrong in the assistant." });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

function parseHistory(value: unknown): ChatTurn[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const turns = value.slice(-MAX_TURNS);
  const parsed: ChatTurn[] = [];
  for (const t of turns as { role?: unknown; content?: unknown }[]) {
    if ((t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string" || !t.content.trim()) return null;
    parsed.push({ role: t.role, content: t.content.slice(0, MAX_TURN_CHARS) });
  }
  while (parsed.length > 0 && parsed[0].role !== "user") parsed.shift();
  if (parsed.length === 0 || parsed[parsed.length - 1].role !== "user") return null;
  return parsed;
}
