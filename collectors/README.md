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

Per request: the URL, the method, the visitor's IP, and five headers —
`user-agent`, the Web Bot Auth signature headers (`signature`,
`signature-input`, `signature-agent`) and `intent-declaration`, which is how
an agent states what it came to do. TrustTab believes a declaration only when
the agent's signature covers that header, so an unsigned one is ignored.

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

After deploying, request a page with a known agent user agent:

```bash
curl -A "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)" https://your-site.example/
```

It should appear in the dashboard under *Likely automated (estimate)* within a
few seconds.
