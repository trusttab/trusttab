# Agent-traffic collectors

TrustTab classifies requests to a site's **TrustTab endpoints** (its manifest
and registry entry) for every site, with nothing to install: those requests
arrive at TrustTab. That panel works for everyone.

To also see agent traffic to **your own pages**, install one of these
collectors. This is opt-in per site: turn it on in the dashboard under *Agent
traffic*, copy the token, then deploy a collector.

| Your site runs on | Use |
|---|---|
| Next.js, Node, or anything with per-request code | [`nextjs-proxy.ts`](nextjs-proxy.ts) |
| Your own Cloudflare zone (any plan, including Free) | [`cloudflare-worker.js`](cloudflare-worker.js) |
| A no-code host (Base44, Webflow, Wix, Squarespace) | See below |

## What a collector sends

Per request: the URL, the method, the visitor's IP, and six headers —
`user-agent`, the Web Bot Auth signature headers (`signature`,
`signature-input`, `signature-agent`), `intent-declaration`, which is how an
agent states what it came to do, and `x-trusttab-agent`, which you can set on
an agent you built yourself so its traffic carries your own label. TrustTab
believes a declaration only when the agent's signature covers that header, so
an unsigned one is ignored.

It never sends cookies, query strings, form fields or page content. TrustTab
uses the IP in memory to match published agent ranges and stores only a
coarsened form (IPv4 /24, IPv6 /48). Rows are deleted after 30 days.
Reporting happens after the response, so it never slows a page down, and a
failed report is ignored rather than breaking the request.

## No-code hosts: what's actually possible

On platforms that own the routing (Base44, Webflow, Wix, Squarespace), page
requests never reach code you control, so **no collector can run there**.
Their built-in analytics are client-side JavaScript, and an agent fetching
raw HTML runs no JavaScript, so those visits aren't in your analytics either.

There is one honest option, and it is a real change to how your site is
served: put **your own Cloudflare zone in front of your host** and run the
Worker there.

1. Add your domain to Cloudflare and change your nameservers to Cloudflare's.
2. Point the DNS records at your existing host, **proxy off (grey cloud)** at
   first, and let your host finish issuing its certificate.
3. Turn the proxy on (orange cloud) and set SSL/TLS mode to **Full**.
4. Deploy `cloudflare-worker.js` and add a route for your domain.

Trade-offs to weigh first: your traffic now passes through an extra service
you administer, a misconfiguration can take the site offline, and some hosts
have specific requirements for being proxied ([Render, which Base44 uses,
documents this](https://render.com/docs/configure-cloudflare-dns)). If that
isn't a trade you want, the TrustTab-endpoint panel still works with nothing
installed.

### Worked example: a Base44 site (leasetab.com)

leasetab.com is the first real TrustTab site and a typical no-code case, so
here are its actual records and what changes. Check your own with
`dig +short NS your-domain.com` before starting: yours will differ.

Today (DNS at Namecheap, pointing straight at Base44's host on Render):

```
NS      dns1.registrar-servers.com, dns2.registrar-servers.com
@   A   216.24.57.1            # Render's anycast address
www CNAME base44.onrender.com
```

The Cloudflare in front of it today belongs to Render, not to the site owner,
so there is no Cloudflare dashboard to add a Worker to. To get one:

1. **Add the domain to Cloudflare** (Free plan is enough) and let it import
   the records above. Set every record to **DNS only (grey cloud)** for now.
2. **Change the nameservers at Namecheap** to the two Cloudflare gives you.
   Nothing about the site changes yet: traffic still goes straight to Render.
3. **Wait for Base44/Render to confirm the domain is still verified** and its
   certificate is current. Render issues certificates over HTTP, and a proxy
   turned on too early blocks that.
4. **Keep AAAA records absent.** Render has no IPv6 addresses, and a stray
   AAAA record sends traffic nowhere. leasetab.com has none today; don't add
   any.
5. **Turn the proxy on (orange cloud)** for `@` and `www`, and set SSL/TLS to
   **Full**. Load the site and confirm it still works before continuing.
6. **Deploy the Worker and route it:**

   ```bash
   npx wrangler deploy collectors/cloudflare-worker.js --name trusttab-collector
   npx wrangler secret put TRUSTTAB_TOKEN     # paste the token from the dashboard
   ```

   Then add routes `leasetab.com/*` and `www.leasetab.com/*` to that Worker.
7. **Check it:**

   ```bash
   curl -A "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" https://leasetab.com/
   ```

   It should appear under *Agent traffic → Your own pages* within seconds.

To undo: remove the Worker routes (collection stops, the site is unaffected),
or point the nameservers back to Namecheap to leave Cloudflare entirely.
Turning collection off in the dashboard invalidates the token, so even a
Worker left running can no longer report.

## Verifying it works

Check the dashboard first: under *Agent traffic → Your own pages* it says
whether your collector has reached TrustTab at all, and when. That is the one
check that tests the whole path — Worker deployed, token configured on it,
route matching, TrustTab reachable.

- **"Your collector is connected"** — the token works. You can stop here.
- **"Your collector has never reached TrustTab"** — something between your
  Worker and TrustTab is wrong. See below.

Then, to confirm classification end to end, request a page with a known agent
user agent:

```bash
curl -A "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" https://your-site.example/
```

It should appear under *Likely automated (estimate)* within a few seconds.

### Setting the token, exactly

`wrangler secret put` takes the secret's **name** as its argument and asks for
the value interactively. Passing the token itself creates a secret *named*
after your token, and `env.TRUSTTAB_TOKEN` then never exists — the Worker runs,
reports nothing, and says nothing about it. This has happened:

```bash
npx wrangler secret put TRUSTTAB_TOKEN     # correct: the NAME goes here
# ✔ Enter a secret value: ›                # the token goes here, at the prompt
```

```bash
npx wrangler secret put 3005bcfa-….abc123  # wrong: creates a secret named after the token
```

Confirm with `npx wrangler secret list` — you should see `TRUSTTAB_TOKEN` and
nothing that looks like a token.

### If the dashboard says your collector has never connected

Work outwards from the Worker, not from TrustTab:

1. `npx wrangler secret list` — is there a secret called exactly
   `TRUSTTAB_TOKEN`?
2. Is the Worker on a route your traffic actually takes (`example.com/*`)?
3. Is the deployed Worker the current file? Redeploy if unsure.
4. Only then test the token against TrustTab directly:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     "https://trusttab-mu.vercel.app/api/enforcement/feed"
   ```

**That last check proves the server accepts the token. It says nothing about
whether your Worker holds it.** A token can be perfectly valid and the Worker
still have no `TRUSTTAB_TOKEN` at all — the curl passes, the collector stays
silent, and the two facts look like a contradiction. The dashboard indicator is
the only check that covers the Worker's own configuration, which is why it
comes first.

## Observe-only enforcement (Cloudflare Worker only, off by default)

The Cloudflare Worker can additionally work out, at your own edge, whether each
request fell outside what the agent declared — and report that conclusion so you
can see what enforcement *would* have done.

**It does not block anything, and no code here can.** Blocking is separate work
that begins only after these observations have been reviewed against real
traffic. The Worker returns your origin's response on every path, and
`edge-parity.test.ts` asserts it never constructs a response of its own.

Turn it on with one variable, after collection is already working:

```bash
npx wrangler deploy collectors/cloudflare-worker.js --name trusttab-collector
# then, in the Worker's settings or wrangler.toml:
TRUSTTAB_FEED = "1"
```

Your dashboard then shows, under Agent traffic, what your edge concluded next to
what TrustTab concluded about the same requests.

### How it can't take your site down

- **No TrustTab call sits in your request path.** The Worker fetches a small
  rule feed on its own schedule. Your visitors never wait on us. (This was the
  deciding measurement: a round trip to TrustTab costs ~190–280ms warm and
  **3.2 seconds cold**, from a single region. Nothing that slow belongs in
  front of your site.)
- **It fails open by expiry.** Every feed carries its own `expires_at`, a few
  minutes out. If TrustTab is slow, broken or unreachable, the feed goes stale
  and the Worker stops evaluating. There is deliberately no "last known rules"
  fallback: that would keep acting on rules nobody could correct.
- **The feed is signed.** The Worker checks a detached Ed25519 signature over
  the exact bytes it received, against the keys at
  `/.well-known/jwks.json`, and ignores a feed that doesn't verify.

### Edge-side signature verification

The Worker verifies each request's RFC 9421 signature itself, against public
keys the feed supplies. It never fetches a key directory: `Signature-Agent`
names that URL and is attacker-controlled, so an edge fetching it would be a
request-forgery and amplification vector. TrustTab does that fetching, through
a fetcher built to refuse private addresses, and distributes the keys.

**Deploy from a repo checkout.** Verification uses the `web-bot-auth` library,
which wrangler bundles at deploy time:

```bash
git clone https://github.com/trusttab/trusttab && cd trusttab && npm install
npx wrangler deploy collectors/cloudflare-worker.js --name trusttab-collector
```

Pasting the file into the Cloudflare dashboard editor skips that bundling. The
Worker still runs and still reports traffic — it reports `unavailable` for the
signature verdict instead of failing to start — but you get no local
verification. The library is loaded dynamically inside a `catch` specifically
so this degrades rather than breaking.

**Your edge and TrustTab will sometimes disagree, and that is expected.** They
don't examine the same bytes: your edge sees the request as it arrived, while
TrustTab rebuilds one from the six headers this Worker forwards. A signature
covering a header that isn't forwarded verifies at your edge and fails at
TrustTab — the signature is fine, and the difference measures what the
collector carries. The dashboard names which kind of difference occurred
rather than declaring either side correct, and flags only the one combination
that has no routine explanation.
- **The Node/Next.js collector does not do any of this.** It still reports
  traffic exactly as before, and setting `TRUSTTAB_FEED` does nothing there.
  Observe-only enforcement is Cloudflare-only for now. If you run the Node
  collector, you can watch agent traffic and declared-intent mismatches in the
  dashboard as usual — you just won't get the edge's own second opinion.
