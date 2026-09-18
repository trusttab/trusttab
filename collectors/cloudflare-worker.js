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
 * Intent-Declaration the agent signed. TrustTab uses the IP in
 * memory to match published agent ranges and stores only a coarsened form
 * (IPv4 /24, IPv6 /48). No cookies, query strings or page content are sent.
 *
 * Setup:
 *   1. Dashboard → your site → Agent traffic → turn on collection, copy the token.
 *   2. npx wrangler deploy collectors/cloudflare-worker.js --name trusttab-collector
 *   3. npx wrangler secret put TRUSTTAB_TOKEN     (paste the token)
 *   4. Add a route for your zone, e.g. example.com/*, pointing at this Worker.
 *
 * If your site is on a no-code host (Base44, Webflow, Wix, Squarespace), see
 * collectors/README.md: you need your own Cloudflare zone in front of it
 * first, which is a DNS change, not a change to the site.
 */

const TRUSTTAB_URL = "https://trusttab-mu.vercel.app";
/** Only these headers are forwarded. */
const FORWARDED = ["user-agent", "signature", "signature-input", "signature-agent", "intent-declaration"];

const worker = {
  async fetch(request, env, ctx) {
    const response = await fetch(request);
    if (env.TRUSTTAB_TOKEN) ctx.waitUntil(report(request, env).catch(() => {}));
    return response;
  },
};

export default worker;

async function report(request, env) {
  const headers = {};
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  await fetch(`${env.TRUSTTAB_URL ?? TRUSTTAB_URL}/api/agent-traffic/ingest`, {
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
        },
      ],
    }),
  });
}
