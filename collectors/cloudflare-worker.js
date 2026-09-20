/**
 * TrustTab agent-traffic collector for Cloudflare Workers.
 *
 * Deploy this in front of your site (any Cloudflare plan, including Free) to
 * see which AI agents request your pages. It reports to TrustTab after the
 * response is already on its way, so it never slows a request down, and it
 * never blocks anything.
 *
 * What it sends per request: the URL, the method, the visitor's IP, and the
 * user agent plus the Web Bot Auth signature headers, including any
 * Intent-Declaration the agent signed, plus x-trusttab-agent, which is how
 * you can tag an agent you built yourself. TrustTab uses the IP in
 * memory to match published agent ranges and stores only a coarsened form
 * (IPv4 /24, IPv6 /48). No cookies, query strings or page content are sent.
 *
 * ## Observe-only enforcement (optional, off unless you set TRUSTTAB_FEED)
 *
 * With TRUSTTAB_FEED=1 the Worker also fetches a short-lived signed rule feed
 * and works out, locally, whether each request fell outside what the agent
 * declared — and reports that conclusion alongside the request.
 *
 * **It does not block, throttle, challenge or alter anything.** No code here
 * can: every path returns the origin's response untouched. The point of this
 * milestone is evidence — what enforcement *would* have concluded on real
 * traffic — which the site owner reviews before blocking is built at all.
 *
 * Two safety properties worth understanding before you turn it on:
 *
 *  - **It fails open by expiry, not by configuration.** Every feed carries its
 *    own expires_at. If TrustTab is slow, broken or gone, the feed goes stale
 *    within minutes and this Worker stops evaluating entirely. There is no
 *    "last known rules" fallback, deliberately: that would keep acting on
 *    rules nobody could correct.
 *  - **Its conclusion is provisional.** This Worker does not verify the
 *    RFC 9421 signature itself yet, so it reads the declaration as presented.
 *    TrustTab re-checks the same request server-side against the verified
 *    signature, and your dashboard shows both. Where they disagree, the
 *    server's verdict is the true one — and the disagreement is exactly what
 *    needs to be understood before an edge is ever trusted to act.
 *
 * Setup:
 *   1. Dashboard → your site → Agent traffic → turn on collection, copy the token.
 *   2. npx wrangler deploy collectors/cloudflare-worker.js --name trusttab-collector
 *   3. npx wrangler secret put TRUSTTAB_TOKEN
 *      ...then paste the token at the "Enter a secret value" prompt. The
 *      argument is the secret's NAME; passing the token there creates a secret
 *      named after it, leaving env.TRUSTTAB_TOKEN undefined and this Worker
 *      silently reporting nothing.
 *   4. Add a route for your zone, e.g. example.com/*, pointing at this Worker.
 *   5. Optional: set TRUSTTAB_FEED=1 to enable the observe-only evaluation above.
 *
 * If your site is on a no-code host (Base44, Webflow, Wix, Squarespace), see
 * collectors/README.md: you need your own Cloudflare zone in front of it
 * first, which is a DNS change, not a change to the site.
 */

const TRUSTTAB_URL = "https://trusttab-mu.vercel.app";
/** Only these headers are forwarded. */
const FORWARDED = ["user-agent", "signature", "signature-input", "signature-agent", "intent-declaration", "x-trusttab-agent"];

const FEED_PATH = "/api/enforcement/feed";
const JWKS_PATH = "/.well-known/jwks.json";
const FEED_SIGNATURE_HEADER = "x-trusttab-signature";
/** Don't hammer TrustTab if the feed is failing; retry no faster than this. */
const FEED_RETRY_MS = 30_000;

const worker = {
  async fetch(request, env, ctx) {
    // The origin's response, always, on every path. Nothing below this line
    // may delay, replace or inspect its way into changing it.
    const response = await fetch(request);
    if (env.TRUSTTAB_TOKEN) ctx.waitUntil(report(request, env).catch(() => {}));
    return response;
  },
};

export default worker;

/** In-memory per isolate. A cold isolate simply has no feed and evaluates nothing. */
let feedState = { feed: null, nextFetchAt: 0 };
let jwksCache = null;

function baseUrl(env) {
  return env.TRUSTTAB_URL ?? TRUSTTAB_URL;
}

async function loadJwks(env) {
  if (jwksCache) return jwksCache;
  const res = await fetch(`${baseUrl(env)}${JWKS_PATH}`);
  if (!res.ok) return null;
  jwksCache = await res.json();
  return jwksCache;
}

/** Verifies the detached JWS over the exact feed bytes, with the issuer's published key. */
export async function verifyFeed(body, signature, jwks) {
  const [header, empty, sig] = String(signature).split(".");
  if (!header || empty !== "" || !sig) return false;
  let kid, alg;
  try {
    ({ kid, alg } = JSON.parse(atob(header.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return false;
  }
  const jwk = jwks?.keys?.find((k) => k.kid === kid);
  if (alg !== "EdDSA" || !jwk) return false;

  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
  const signingInput = new TextEncoder().encode(`${header}.${b64url(body)}`);
  return crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(sig), signingInput);
}

const b64url = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (value) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/**
 * The current feed, or null. A feed past its own expires_at is dropped rather
 * than reused: staleness must stop enforcement, not outlive it.
 */
async function currentFeed(env) {
  const now = Date.now();
  if (feedState.feed && Date.parse(feedState.feed.expires_at) > now) return feedState.feed;
  if (now < feedState.nextFetchAt) return null;
  feedState = { feed: null, nextFetchAt: now + FEED_RETRY_MS };

  try {
    const res = await fetch(`${baseUrl(env)}${FEED_PATH}`, { headers: { authorization: `Bearer ${env.TRUSTTAB_TOKEN}` } });
    if (!res.ok) return null;
    const body = await res.text();
    const jwks = await loadJwks(env);
    if (!(await verifyFeed(body, res.headers.get(FEED_SIGNATURE_HEADER), jwks))) return null;

    const feed = JSON.parse(body);
    // A feed that arrives already expired, or that asks for anything other than
    // observation, is not used. This Worker implements no other mode.
    if (feed.mode !== "observe" || !(Date.parse(feed.expires_at) > now)) return null;
    feedState = { feed, nextFetchAt: 0 };
    return feed;
  } catch {
    return null;
  }
}

/**
 * Parses `purpose="booking"; scope="/schedule-tour"`.
 *
 * Kept deliberately simple and deliberately duplicated from
 * src/lib/agent-traffic/intent.ts, because this file is deployed as a single
 * standalone Worker. collectors.test.ts runs the same fixtures through both so
 * the two can't drift apart unnoticed.
 */
export function parseDeclaration(header) {
  if (!header || header.length > 400) return null;
  const purposes = [];
  const scopes = [];
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (!rest.length) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join("=").trim().replace(/^"|"$/g, "");
    if (!value) continue;
    if (key === "purpose" && !purposes.includes(value)) purposes.push(value);
    else if (key === "scope" && value.startsWith("/") && value.length <= 200 && !scopes.includes(value)) scopes.push(value);
  }
  return purposes.length || scopes.length ? { purposes, scopes } : null;
}

function withinScopes(path, scopes) {
  return scopes.some((scope) => path === scope || path.startsWith(scope.endsWith("/") ? scope : `${scope}/`));
}

/**
 * Whether this request fell outside what the agent declared. Mirrors
 * findScopeMismatch in src/lib/agent-traffic/intent.ts: a path outside every
 * declared scope, or a path the site itself publishes under a purpose the agent
 * didn't declare. A path the site publishes nothing about is not a mismatch.
 */
export function evaluate(request, feed) {
  const parsed = parseDeclaration(request.headers.get("intent-declaration"));
  if (!parsed) return null;

  // Drop purposes outside the feed's taxonomy, exactly as the server does. An
  // agent that declared only an unrecognised purpose has, in effect, declared
  // nothing — treating it as a mismatch would penalise it for our vocabulary.
  //
  // A feed with no taxonomy at all drops every purpose rather than trusting
  // them unfiltered: the error that direction is over-reporting a mismatch,
  // which is the one that would eventually become an over-block.
  const known = Array.isArray(feed.purposes) ? feed.purposes : [];
  const declaration = { ...parsed, purposes: parsed.purposes.filter((p) => known.includes(p)) };
  if (declaration.purposes.length === 0 && declaration.scopes.length === 0) return null;

  const path = new URL(request.url).pathname || "/";
  const published = (feed.endpoints ?? []).find((endpoint) => endpoint.path === path) ?? null;

  if (declaration.scopes.length > 0 && !withinScopes(path, declaration.scopes)) return "path-outside-scope";
  if (declaration.purposes.length > 0 && published && !declaration.purposes.includes(published.purpose)) return "purpose-not-declared";
  return null;
}

async function report(request, env) {
  const headers = {};
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  // Observation only, and only when the operator opted in and a live feed says
  // "observe". Its absence changes nothing about the request or the report.
  let observed = null;
  if (env.TRUSTTAB_FEED) {
    const feed = await currentFeed(env);
    if (feed) {
      const reason = evaluate(request, feed);
      observed = { would_block: reason !== null, reason, feed_issued_at: feed.issued_at };
    }
  }

  await fetch(`${baseUrl(env)}/api/agent-traffic/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: env.TRUSTTAB_TOKEN,
      events: [
        {
          url: request.url,
          method: request.method,
          ip: request.headers.get("cf-connecting-ip"),
          headers,
          ...(observed ? { edge_observation: observed } : {}),
        },
      ],
    }),
  });
}
