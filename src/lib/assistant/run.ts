import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { SYSTEM_PROMPT } from "./prompt";
import { executeTool, TOOL_DEFINITIONS, type AssistantContext, type AssistantEvent } from "./tools";

/** Default model; override with ASSISTANT_MODEL. */
export const DEFAULT_ASSISTANT_MODEL = "claude-sonnet-5";

/** Tool-use rounds per owner message, to bound cost and runaway loops. */
const MAX_STEPS = 8;

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * The slice of the Anthropic client the loop needs, so tests can inject a
 * scripted model. `new Anthropic()` satisfies it.
 */
export type ModelClient = {
  messages: {
    stream(
      params: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ): {
      on(event: "text", listener: (delta: string) => void): unknown;
      finalMessage(): Promise<Anthropic.Message>;
    };
  };
};

/**
 * Runs one owner message through the assistant: a manual tool-use loop
 * over the fixed tool allowlist in ./tools.ts, streaming events to `emit`.
 * Every tool call goes through `executeTool`, which only dispatches to that
 * allowlist; the model has no other way to act.
 */
export async function runAssistant(args: {
  client: ModelClient;
  model: string;
  ctx: AssistantContext;
  domain: string;
  history: ChatTurn[];
  emit: (event: AssistantEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { client, model, ctx, emit } = args;

  const messages: Anthropic.MessageParam[] = args.history.map((turn, i) =>
    i === 0 && turn.role === "user"
      ? { role: "user", content: `[Site: ${args.domain}]\n\n${turn.content}` }
      : { role: turn.role, content: turn.content },
  );

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: TOOL_DEFINITIONS,
        messages,
      },
      { signal: args.signal },
    );
    stream.on("text", (delta) => emit({ type: "text", text: delta }));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      emit({ type: "text", text: "\n\nI can't help with that request." });
      return;
    }

    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "max_tokens") {
      emit({ type: "text", text: "\n\n(My reply was cut off. Ask me to continue.)" });
      return;
    }
    if (message.stop_reason !== "tool_use") return;

    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = [];
    // Sequential on purpose: draft edits must apply in order.
    for (const use of toolUses) {
      emit({ type: "tool", name: use.name, status: "started" });
      const output = await executeTool(use.name, use.input, ctx);
      const summary = output.events?.find((e) => e.type === "tool")?.summary;
      for (const event of output.events ?? []) if (event.type !== "tool") emit(event);
      emit({ type: "tool", name: use.name, status: output.isError ? "error" : "done", summary: summary ?? (output.isError ? output.content : undefined) });
      results.push({ type: "tool_result", tool_use_id: use.id, content: output.content, is_error: output.isError });
    }
    messages.push({ role: "user", content: results });
  }

  emit({ type: "text", text: "\n\n(I stopped after several steps. Tell me if you'd like me to keep going.)" });
}
