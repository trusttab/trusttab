/**
 * Integration tests for the dashboard assistant and the human-only publish
 * gate, against a real Postgres database (no network, no model API).
 *
 *   npm run test:integration   (reads DATABASE_URL etc. from .env.local)
 *
 * A scripted fake model drives the real tool loop, including attempts to call
 * tools that would publish, to show the loop can only reach the allowlist and
 * that nothing it does creates a signed manifest.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { draftChanges, manifestDrafts, manifests, sites, users } from "@/db/schema";
import { draftHash, getOrCreateDraft, saveDraft } from "@/lib/drafts";
import { consumePublishConfirmation, issuePublishConfirmation } from "@/lib/publish-gate";

import { runAssistant, type ModelClient } from "@/lib/assistant/run";
import type { AssistantEvent } from "@/lib/assistant/tools";

const userId = `itest-${randomUUID()}`;
let siteId = "";

before(async () => {
  await db.insert(users).values({ id: userId, name: "itest", email: `${userId}@example.org`, emailVerified: true });
  const [site] = await db
    .insert(sites)
    .values({ userId, domain: `${userId}.example.org`, verificationToken: "t", ownershipVerifiedAt: new Date() })
    .returning();
  siteId = site.id;
});

after(async () => {
  await db.delete(users).where(eq(users.id, userId)); // cascades to the site, draft, changes, confirmations
  await db.$client.end(); // close the pool so the test process can exit
});

/** A fake model that replays a fixed script of responses, one per request. */
function scriptedModel(script: Anthropic.ContentBlock[][], seen: Anthropic.MessageStreamParams[]): ModelClient {
  let turn = 0;
  return {
    messages: {
      stream(params) {
        seen.push(structuredClone(params));
        const content = script[turn++] ?? [{ type: "text", text: "(script exhausted)", citations: null }];
        const hasTools = content.some((b) => b.type === "tool_use");
        const message = {
          id: `msg_${turn}`,
          type: "message",
          role: "assistant",
          model: params.model,
          content,
          stop_reason: hasTools ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        } as unknown as Anthropic.Message;
        return {
          on(_event: "text", listener: (delta: string) => void) {
            for (const b of content) if (b.type === "text") listener(b.text);
            return this;
          },
          finalMessage: async () => message,
        };
      },
    },
  };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

describe("assistant tool loop", () => {
  test("drafts land in the saved draft with reasons; publish attempts reach nothing", async () => {
    const seen: Anthropic.MessageStreamParams[] = [];
    const events: AssistantEvent[] = [];
    const client = scriptedModel(
      [
        [
          toolUse("t1", "get_site_overview", {}),
          // A tool that doesn't exist in the allowlist: must be refused.
          toolUse("t2", "publish_manifest", { confirm: true }),
          toolUse("t3", "sign_manifest", {}),
        ],
        [
          toolUse("t4", "add_endpoint", {
            path: "/contact",
            method: "POST",
            purpose: "lead_inquiry",
            fields: [
              { name: "name", type: "string" },
              { name: "email", type: "email" },
            ],
            agent_safe: true,
            requires_captcha: false,
            self_attested: true,
            reason: "The contact form is built by JavaScript; the owner confirmed its fields.",
          }),
        ],
        [toolUse("t5", "add_endpoint", { path: "no-slash", method: "POST", purpose: "lead_inquiry", fields: [], agent_safe: true, requires_captcha: false, self_attested: false, reason: "x" })],
        [{ type: "text", text: "I've added it to your draft. Review it and click Sign & publish yourself.", citations: null } as Anthropic.TextBlock],
      ],
      seen,
    );

    await runAssistant({
      client,
      model: "fake",
      ctx: { userId, siteId },
      domain: "example.org",
      history: [{ role: "user", content: "Publish my manifest now." }],
      emit: (e) => events.push(e),
    });

    // The model was only ever offered the allowlist.
    const offered = seen[0].tools!.map((t) => ("name" in t ? t.name : ""));
    assert.ok(!offered.some((n) => /publish|sign|confirm/.test(n)), `offered: ${offered}`);

    // Unknown tools came back as errors in the conversation.
    const toolResults = (seen[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[]).filter((b) => b.type === "tool_result");
    const byId = Object.fromEntries(toolResults.map((r) => [r.tool_use_id, r]));
    assert.equal(byId.t2.is_error, true);
    assert.match(String(byId.t2.content), /Unknown tool: publish_manifest/);
    assert.equal(byId.t3.is_error, true);
    assert.notEqual(byId.t1.is_error, true);

    // Invalid edits are rejected with an explanation, not applied.
    const invalid = (seen[3].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
    assert.equal(invalid.is_error, true);
    assert.match(String(invalid.content), /Invalid path/);

    // The valid edit is in the saved draft, attributed and explained.
    const draft = await getOrCreateDraft(siteId);
    assert.equal(draft.updatedBy, "assistant");
    assert.deepEqual(draft.input.endpoints.map((e) => [e.method, e.path, e.self_attested]), [["POST", "/contact", true]]);
    const changes = await db.select().from(draftChanges).where(eq(draftChanges.siteId, siteId));
    assert.equal(changes.length, 1);
    assert.match(changes[0].reason, /owner confirmed/);
    assert.ok(events.some((e) => e.type === "draft_changed"));

    // Nothing was published or signed, and the site's status is untouched.
    assert.equal((await db.select().from(manifests).where(eq(manifests.siteId, siteId))).length, 0);
    const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
    assert.equal(site.status, "pending");
  });

  test("assistant edits don't overwrite the owner's newer save", async () => {
    const draft = await getOrCreateDraft(siteId);
    await saveDraft({ siteId, input: { ...draft.input, no_prompt_injection_pledge: true }, baseVersion: draft.version, actor: "owner" });
    await assert.rejects(
      saveDraft({ siteId, input: draft.input, baseVersion: draft.version, actor: "assistant", change: { summary: "s", reason: "r" } }),
      /changed by someone else/,
    );
  });
});

describe("publish confirmation", () => {
  const sessionId = "session-a";

  test("is bound to user, session, site and exact draft hash, single-use", async () => {
    const draft = await getOrCreateDraft(siteId);
    const binding = { userId, sessionId, siteId, draftHash: draft.hash };
    const consume = (overrides: Partial<typeof binding & { token: string }>, token: string) =>
      db.transaction((tx) => consumePublishConfirmation(tx, { ...binding, token, ...overrides }));

    const { token } = await issuePublishConfirmation(binding);
    assert.equal(await consume({ sessionId: "session-b" }, token), false, "other session");
    assert.equal(await consume({ userId: "someone-else" }, token), false, "other user");
    assert.equal(await consume({ draftHash: draftHash({ ...draft.input, endpoints: [] }) }, token), false, "different draft");
    assert.equal(await consume({}, "not-the-token"), false, "wrong token");
    assert.equal(await consume({}, token), true, "exact match");
    assert.equal(await consume({}, token), false, "reuse");
  });

  test("expires", async () => {
    const draft = await getOrCreateDraft(siteId);
    const binding = { userId, sessionId, siteId, draftHash: draft.hash };
    const { token } = await issuePublishConfirmation(binding);
    await db.execute(
      // Age the confirmation past its two-minute lifetime.
      (await import("drizzle-orm")).sql`update publish_confirmations set expires_at = now() - interval '1 second' where site_id = ${siteId} and used_at is null`,
    );
    assert.equal(await db.transaction((tx) => consumePublishConfirmation(tx, { ...binding, token })), false);
  });

  test("a failed publish transaction doesn't burn the confirmation", async () => {
    const draft = await getOrCreateDraft(siteId);
    const binding = { userId, sessionId, siteId, draftHash: draft.hash };
    const { token } = await issuePublishConfirmation(binding);
    await assert.rejects(
      db.transaction(async (tx) => {
        assert.equal(await consumePublishConfirmation(tx, { ...binding, token }), true);
        throw new Error("validation failed");
      }),
    );
    assert.equal(await db.transaction((tx) => consumePublishConfirmation(tx, { ...binding, token })), true);
    await db.delete(manifestDrafts).where(eq(manifestDrafts.siteId, siteId));
  });
});
