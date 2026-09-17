/**
 * Integration tests for site-wide agent traffic: the collector token, the
 * ingest endpoint, and what actually gets stored. Runs against a real
 * Postgres database; no model or network calls.
 *
 *   npm run test:integration   (reads DATABASE_URL etc. from .env.local)
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { POST } from "@/app/api/agent-traffic/ingest/route";
import { db } from "@/db";
import { siteAgentHits, sites, users } from "@/db/schema";
import { issueCollectorToken, recordSiteHits, siteForCollectorToken } from "@/lib/agent-traffic/collector";

const userId = `itest-traffic-${randomUUID()}`;
let siteId = "";
let token = "";

before(async () => {
  await db.insert(users).values({ id: userId, name: "itest", email: `${userId}@example.org`, emailVerified: true });
  const [site] = await db
    .insert(sites)
    .values({ userId, domain: `${userId}.example.org`, verificationToken: "t", ownershipVerifiedAt: new Date() })
    .returning();
  siteId = site.id;
  const issued = issueCollectorToken(siteId);
  token = issued.token;
  await db.update(sites).set({ agentTrafficEnabledAt: new Date(), agentTrafficTokenHash: issued.hash }).where(eq(sites.id, siteId));
});

after(async () => {
  await db.delete(users).where(eq(users.id, userId)); // cascades to the site and its hits
  await db.$client.end();
});

const ingest = (body: unknown) =>
  POST(new Request("http://localhost/api/agent-traffic/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("collector tokens", () => {
  test("a valid token resolves to its site", async () => {
    assert.equal((await siteForCollectorToken(token))?.id, siteId);
  });

  test("a wrong secret, another site's id, or junk resolves to nothing", async () => {
    const [id, secret] = [token.split(".")[0], token.split(".").slice(1).join(".")];
    for (const bad of [`${id}.${secret}x`, `${randomUUID()}.${secret}`, "nonsense", "", null, 42, `${id}.short`]) {
      assert.equal(await siteForCollectorToken(bad), null, String(bad).slice(0, 30));
    }
  });

  test("turning collection off invalidates the token", async () => {
    await db.update(sites).set({ agentTrafficEnabledAt: null }).where(eq(sites.id, siteId));
    assert.equal(await siteForCollectorToken(token), null);
    await db.update(sites).set({ agentTrafficEnabledAt: new Date() }).where(eq(sites.id, siteId));
    assert.equal((await siteForCollectorToken(token))?.id, siteId);
  });
});

describe("recordSiteHits", () => {
  test("classifies reported requests and stores only a coarsened IP", async () => {
    const stored = await recordSiteHits(siteId, [
      {
        url: "https://example.org/contact?utm_source=secret",
        method: "GET",
        ip: "203.0.113.42",
        headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" },
      },
    ]);
    assert.equal(stored, 1);

    const [row] = await db.select().from(siteAgentHits).where(eq(siteAgentHits.siteId, siteId));
    assert.equal(row.agentTier, "likely_automated");
    assert.equal(row.agentIdentity, "GPTBot (OpenAI)");
    assert.equal(row.requesterIp, "203.0.113.0", "full IP must never be stored");
    assert.equal(row.path, "/contact", "query strings are not stored");
  });

  test("events with unusable URLs are skipped rather than stored", async () => {
    assert.equal(await recordSiteHits(siteId, [{ url: "not a url" }, { url: "file:///etc/passwd" }]), 0);
  });
});

describe("POST /api/agent-traffic/ingest", () => {
  test("rejects an unknown token the same way as a disabled one", async () => {
    const unknown = await ingest({ token: `${randomUUID()}.abcdefghijklmnop`, events: [] });
    assert.equal(unknown.status, 401);
    assert.match(JSON.stringify(await unknown.json()), /Unknown or disabled/);
  });

  test("accepts reported events and returns how many were stored", async () => {
    const response = await ingest({
      token,
      events: [
        { url: "https://example.org/pricing", ip: "203.0.113.9", headers: { "user-agent": "Mozilla/5.0 (compatible; ClaudeBot/1.0)" } },
        { url: "https://example.org/", ip: "203.0.113.9", headers: { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/141.0.0.0" } },
      ],
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: 2 });

    const rows = await db.select().from(siteAgentHits).where(eq(siteAgentHits.siteId, siteId));
    assert.ok(rows.some((r) => r.agentIdentity === "ClaudeBot (Anthropic)"));
    assert.ok(rows.some((r) => r.agentTier === "unclassified"));
  });

  test("malformed and oversized bodies", async () => {
    assert.equal((await ingest({ token })).status, 400);
    const big = new Request("http://localhost/api/agent-traffic/ingest", { method: "POST", body: "x".repeat(70_000) });
    assert.equal((await POST(big)).status, 413);
  });
});
