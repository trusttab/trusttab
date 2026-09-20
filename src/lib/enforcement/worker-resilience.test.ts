import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import worker from "../../../collectors/cloudflare-worker.js";

/**
 * Reporting must survive the observation failing.
 *
 * Found the hard way: the enforcement observation was sequenced *before* the
 * traffic report, so a feed fetch that never settled meant the report never
 * went out — silently, because the reporter's errors are swallowed so they
 * can't disturb the customer's site. An addition that can silence the thing it
 * was added to is worse than not having it.
 *
 * These run the real Worker with a stubbed network, rather than asserting
 * about its source, because the property is behavioural.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ENV = { TRUSTTAB_TOKEN: "site.a-secret-long-enough", TRUSTTAB_FEED: "1" };

/** Runs one request through the Worker; returns which URLs it called. */
async function run(feedBehaviour: (url: string) => Promise<Response> | null) {
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const override = feedBehaviour(url);
    if (override) return override;
    if (url.includes("/api/agent-traffic/ingest")) return Promise.resolve(new Response("{}", { status: 202 }));
    return Promise.resolve(new Response("origin", { status: 200 }));
  }) as typeof fetch;

  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch(new Request("https://example.com/"), ENV, {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  });
  await Promise.allSettled(pending);
  return { response, calls, reported: calls.some((c) => c.includes("/api/agent-traffic/ingest")) };
}

describe("the traffic report survives any observation failure", () => {
  test("a feed that never settles does not prevent the report", async () => {
    const started = Date.now();
    const { reported, response } = await run((url) =>
      url.includes("/api/enforcement/feed") ? (new Promise(() => {}) as Promise<Response>) : null,
    );
    assert.equal(response.status, 200, "the origin's response is returned regardless");
    assert.equal(reported, true, "the traffic report still goes out");
    assert.ok(Date.now() - started < 8000, "and is not held open indefinitely");
  });

  test("a feed fetch that throws does not prevent the report", async () => {
    const { reported } = await run((url) =>
      url.includes("/api/enforcement/feed") ? Promise.reject(new Error("network down")) : null,
    );
    assert.equal(reported, true);
  });

  test("an unparseable feed does not prevent the report", async () => {
    const { reported } = await run((url) =>
      url.includes("/api/enforcement/feed") ? Promise.resolve(new Response("not json", { status: 200 })) : null,
    );
    assert.equal(reported, true);
  });

  test("an unreachable JWKS does not prevent the report", async () => {
    const { reported } = await run((url) => (url.includes("jwks") ? Promise.reject(new Error("no jwks")) : null));
    assert.equal(reported, true);
  });

  test("a 401 from the feed does not prevent the report", async () => {
    const { reported } = await run((url) =>
      url.includes("/api/enforcement/feed") ? Promise.resolve(new Response("{}", { status: 401 })) : null,
    );
    assert.equal(reported, true, "a bad token costs the observation, not the collection");
  });

  test("with observation switched off the Worker never calls the feed at all", async () => {
    const calls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/api/agent-traffic/ingest")) return Promise.resolve(new Response("{}", { status: 202 }));
      return Promise.resolve(new Response("origin", { status: 200 }));
    }) as typeof fetch;

    const pending: Promise<unknown>[] = [];
    await worker.fetch(new Request("https://example.com/"), { TRUSTTAB_TOKEN: ENV.TRUSTTAB_TOKEN }, {
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    await Promise.allSettled(pending);

    assert.ok(!calls.some((c) => c.includes("/api/enforcement/feed")), "no feed fetch when TRUSTTAB_FEED is unset");
    assert.ok(calls.some((c) => c.includes("/api/agent-traffic/ingest")), "traffic is still reported");
  });
});
