/**
 * Integration tests for site-wide agent traffic: the collector token, the
 * ingest endpoint, and what actually gets stored. Runs against a real
 * Postgres database; no model or network calls.
 *
 *   npm run test:integration   (reads DATABASE_URL etc. from .env.local)
 */
import assert from "node:assert/strict";
import { randomUUID, webcrypto as crypto } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { POST } from "@/app/api/agent-traffic/ingest/route";
import { jwkToKeyID, sign } from "web-bot-auth";

import { db } from "@/db";
import { manifestEndpoints, manifests, ownerAgents, siteAgentHits, sites, users } from "@/db/schema";
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

/**
 * Declared intent, end to end: a signed declaration reaches the database with
 * the request that carried it, and a request outside that declaration is
 * recorded as a mismatch. The tamper-evidence this relies on is proven in
 * src/lib/agent-traffic/intent.test.ts.
 */
const SITE_URL = "https://example.org";

async function signedEvent(path: string, declaration: string | null) {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey & { kid?: string };
    const keyid = await jwkToKeyID(
      { ...jwk, kid: undefined } as JsonWebKey,
      (data: BufferSource) => crypto.subtle.digest("SHA-256", data),
      (bytes: ArrayBuffer) => Buffer.from(bytes).toString("base64url"),
    );
    const headers: Record<string, string> = {
      "user-agent": "ExampleAgent/1.0",
      "signature-agent": '"https://agent.example.com"',
      ...(declaration ? { "intent-declaration": declaration } : {}),
    };
    const request = new Request(`${SITE_URL}${path}`, { headers });
    const fields = await sign(request, {
      signer: {
        algorithm: "ed25519",
        keyid,
        sign: async (data: Uint8Array) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new Uint8Array(data).slice())),
      },
      expires: new Date(Date.now() + 300_000),
      signatureAgentKey: "signature-agent",
      ...(declaration ? { additionalComponents: ["intent-declaration"] } : {}),
    });
  return {
    event: {
      url: `${SITE_URL}${path}`,
      method: "GET",
      ip: "203.0.113.20",
      headers: { ...headers, signature: fields.signature, "signature-input": fields.signatureInput },
    },
    keys: [{ ...jwk, kid: keyid }],
  };
}

describe("declared intent through ingest", () => {
  before(async () => {
    const [manifest] = await db
      .insert(manifests)
      .values({
        siteId,
        version: 1,
        payloadJson: {} as never,
        signature: "sig..sig",
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    await db.insert(manifestEndpoints).values({
      manifestId: manifest.id,
      path: "/schedule-tour",
      method: "POST",
      purpose: "booking",
      schemaJson: { name: "string" },
      agentSafe: true,
      requiresCaptcha: false,
    });
  });

  test("a signed declaration is stored with the request that carried it", async () => {
    const { event, keys } = await signedEvent("/schedule-tour", 'purpose="booking"; scope="/schedule-tour"');
    assert.equal(await recordSiteHits(siteId, [event], { loadKeys: async () => keys }), 1);

    const [row] = await db.select().from(siteAgentHits).where(eq(siteAgentHits.path, "/schedule-tour"));
    assert.equal(row.agentTier, "verified");
    assert.equal(row.agentIdentity, "https://agent.example.com");
    assert.equal(row.declaredIntent, "booking under /schedule-tour");
    assert.equal(row.scopeMismatch, null, "a request inside the declared scope is not a mismatch");
  });

  test("a request outside the declared scope is recorded as a mismatch", async () => {
    const { event, keys } = await signedEvent("/account", 'purpose="booking"; scope="/schedule-tour"');
    await recordSiteHits(siteId, [event], { loadKeys: async () => keys });

    const [row] = await db.select().from(siteAgentHits).where(eq(siteAgentHits.path, "/account"));
    assert.equal(row.scopeMismatch, "path-outside-scope");
    assert.equal(row.declaredIntent, "booking under /schedule-tour");
  });

  test("a verified agent with no declaration stores none, and is not a mismatch", async () => {
    const { event, keys } = await signedEvent("/pricing-page", null);
    await recordSiteHits(siteId, [event], { loadKeys: async () => keys });

    const [row] = await db.select().from(siteAgentHits).where(eq(siteAgentHits.path, "/pricing-page"));
    assert.equal(row.agentTier, "verified");
    assert.equal(row.declaredIntent, null);
    assert.equal(row.scopeMismatch, null);
  });
});

/**
 * Owner-registered agents: the owner's own label for their own traffic. Lower
 * bar than declared intent by design (there is nobody to deceive), but a
 * verified signature still outranks it.
 */
describe("owner-registered agents", () => {
  before(async () => {
    await db.insert(ownerAgents).values({ siteId, name: "Lead Follow-up Bot", matchType: "user_agent", matchValue: "MyCompanyBot" });
  });

  test("traffic matching a registered signal is labelled with the owner's name for it", async () => {
    await recordSiteHits(siteId, [
      { url: "https://example.org/leads", method: "POST", ip: "203.0.113.31", headers: { "user-agent": "MyCompanyBot/2.1 (+built on Base44)" } },
    ]);

    const [row] = await db.select().from(siteAgentHits).where(eq(siteAgentHits.path, "/leads"));
    assert.equal(row.agentTier, "owner_identified");
    assert.equal(row.agentIdentity, "Your agent: Lead Follow-up Bot");
    assert.match(row.agentSignal ?? "", /you registered the user agent/);
    assert.equal(row.method, "POST", "the timeline needs the method");
  });

  test("a verified signature outranks the owner's label", async () => {
    const { event, keys } = await signedEvent("/leads-signed", null);
    await recordSiteHits(siteId, [{ ...event, headers: { ...event.headers, "user-agent": "MyCompanyBot/2.1" } }], {
      loadKeys: async () => keys,
    });

    const [row] = await db.select().from(siteAgentHits).where(eq(siteAgentHits.path, "/leads-signed"));
    assert.equal(row.agentTier, "verified");
  });

  test("traffic that matches nothing stays unclassified rather than borrowing a label", async () => {
    await recordSiteHits(siteId, [
      { url: "https://example.org/plain", ip: "203.0.113.32", headers: { "user-agent": "Mozilla/5.0 (Macintosh) Chrome/141.0.0.0" } },
    ]);
    const [row] = await db.select().from(siteAgentHits).where(eq(siteAgentHits.path, "/plain"));
    assert.equal(row.agentTier, "unclassified");
  });
});
