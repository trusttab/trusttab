/**
 * Integration tests for the rate limiter fixes made with AI Check 2b, and
 * the parts of POST /api/ai-check/text that run before any model call,
 * against a real Postgres database. No model API is called.
 *
 *   npm run test:integration   (reads DATABASE_URL etc. from .env.local)
 */
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { consumeRateLimit, enforcePaidRateLimits } from "@/lib/rate-limit";

import { POST as POST_IMAGE } from "@/app/api/ai-check/image/route";
import { OPTIONS, POST } from "@/app/api/ai-check/text/route";

// The route reads the key per request. Its model paths are not exercised; a
// placeholder key lets the paths before the model call run.
process.env.ANTHROPIC_API_KEY ??= "itest-placeholder-never-used";

after(async () => {
  await db.$client.end();
});

const randomIp = () => `198.51.100.${randomInt(1, 255)}`;
const request = (ip: string | null, body: unknown = {}) =>
  new Request("http://localhost/api/ai-check/text", {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("consumeRateLimit windows", () => {
  test("pruning never cuts a day-long window short", async () => {
    const key = `itest-day:${randomUUID()}`;
    assert.equal((await consumeRateLimit(key, 2, 86_400)).allowed, true);
    // Make the window look 2 hours old (the old pruning rule deleted anything over an hour).
    await db.execute(sql`UPDATE rate_limit_buckets SET window_start = now() - interval '2 hours' WHERE expires_at > now() + interval '23 hours'`);
    await db.execute(sql`DELETE FROM rate_limit_buckets WHERE expires_at < now()`);
    assert.equal((await consumeRateLimit(key, 2, 86_400)).allowed, true);
    const third = await consumeRateLimit(key, 2, 86_400);
    assert.equal(third.allowed, false, "the count survived pruning");
    assert.ok(third.retryAfter > 23 * 3600);
  });

  test("an expired window starts over", async () => {
    const key = `itest-short:${randomUUID()}`;
    await consumeRateLimit(key, 1, 60);
    assert.equal((await consumeRateLimit(key, 1, 60)).allowed, false);
    await db.execute(sql`UPDATE rate_limit_buckets SET expires_at = now() - interval '1 second' WHERE expires_at <= now() + interval '60 seconds' AND count = 2`);
    assert.equal((await consumeRateLimit(key, 1, 60)).allowed, true);
  });
});

describe("enforcePaidRateLimits", () => {
  const rules = (id: string) => [
    { name: `itest-client-${id}`, limit: 2, windowSeconds: 3600, message: "client limit" },
    { name: `itest-global-${id}`, perClient: false, limit: 3, windowSeconds: 86_400, status: 503, message: "global cap" },
  ];

  test("fails closed without a client IP", async () => {
    const response = await enforcePaidRateLimits(request(null), rules(randomUUID()));
    assert.equal(response?.status, 400);
    assert.equal(response?.headers.get("cache-control"), "no-store");
  });

  test("per-client limit, then a shared global budget that rejected requests don't use up", async () => {
    const id = randomUUID();
    const a = randomIp();
    assert.equal(await enforcePaidRateLimits(request(a), rules(id)), null);
    assert.equal(await enforcePaidRateLimits(request(a), rules(id)), null);
    const limited = await enforcePaidRateLimits(request(a), rules(id));
    assert.equal(limited?.status, 429);
    assert.ok(Number(limited?.headers.get("retry-after")) > 0);

    // Global budget is 3; client A used 2 (its rejected third request didn't count).
    const b = a === "198.51.100.254" ? "203.0.113.9" : "203.0.113.10";
    assert.equal(await enforcePaidRateLimits(request(b), rules(id)), null);
    const capped = await enforcePaidRateLimits(request(b), rules(id));
    assert.equal(capped?.status, 503);
    assert.match(await capped!.text(), /global cap/);
  });
});

describe("POST /api/ai-check/text before the model call", () => {
  test("CORS preflight allows the extension, without credentials", async () => {
    const response = OPTIONS();
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
  });

  test("short text is answered without limits or a client IP", async () => {
    const response = await POST(request(null, { text: "Only a handful of words." }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: "not_enough_text", words_analyzed: 5 });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test("long text without a client IP is refused before any model call", async () => {
    const response = await POST(request(null, { text: "word ".repeat(400) }));
    assert.equal(response.status, 400);
  });

  test("malformed and oversized bodies", async () => {
    assert.equal((await POST(request(randomIp(), "not json"))).status, 400);
    assert.equal((await POST(request(randomIp(), { text: 42 }))).status, 400);
    assert.equal((await POST(request(randomIp(), { text: "x".repeat(70_000) }))).status, 413);
  });
});

describe("POST /api/ai-check/image before the model call", () => {
  const imageRequest = (ip: string | null, body: BodyInit, type = "image/jpeg") =>
    new Request("http://localhost/api/ai-check/image", {
      method: "POST",
      headers: { "content-type": type, ...(ip ? { "x-forwarded-for": ip } : {}) },
      body,
    });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

  test("only JPEG bodies within the size limit", async () => {
    assert.equal((await POST_IMAGE(imageRequest(randomIp(), jpeg, "image/png"))).status, 415);
    assert.equal((await POST_IMAGE(imageRequest(randomIp(), new Uint8Array([0x89, 0x50, 0x4e, 0x47])))).status, 400);
    assert.equal((await POST_IMAGE(imageRequest(randomIp(), new Uint8Array(1_600_000)))).status, 413);
  });

  test("a JPEG without a client IP is refused before any model call", async () => {
    const response = await POST_IMAGE(imageRequest(null, jpeg));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });
});
