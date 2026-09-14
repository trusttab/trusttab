# TrustTab — Project Context

This file is the persistent context for this repository. Read this in full
before writing any code, and re-check it before starting each new day of work.

---

## What this is

TrustTab is a trust/verification protocol for the agentic-commerce era. A
SaaS platform or small business publishes a signed manifest at
`/.well-known/agent-trust.json` declaring which of its forms/endpoints are
safe and correctly structured for an AI agent to act on (fill a contact
form, book an appointment, submit a support ticket). TrustTab verifies the
claim automatically, issues a badge, and hosts a public lookup endpoint so
anyone — an agent platform, a curious user, another business — can confirm
the badge is current and real.

**What TrustTab is NOT:** it is not an agent-identity or payments protocol.
Projects like Visa's Trusted Agent Protocol, Google's AP2, and Proof's x401
already solve "is this a real, authorized agent acting on someone's behalf"
for commerce/payments. TrustTab solves a different, adjacent problem: "can
this specific site's forms be safely and correctly filled out by an agent,
and does the page contain any hidden content trying to manipulate an agent."
Positioning language: *complements* those protocols, doesn't compete with
them. Keep this distinction in mind in any user-facing copy (README, landing
page) — don't accidentally position this as a payments/identity product.

---

## Licensing & open-source strategy — READ BEFORE STRUCTURING THE REPO

This repository will be pushed to GitHub as open source (MIT license) from
day one, with the intent to layer a hosted product on top over time. This
has one concrete architectural implication:

- **The code is fully open.** Anyone can read, fork, and self-host it.
- **The trust in the badge comes from the hosted registry, not the code.**
  A self-hosted fork can issue its own signed manifests, but those
  signatures only verify against *that fork's* keys. The canonical,
  publicly-trusted TrustTab badge is only meaningful when it resolves
  against `GET /v1/verify/:id` on the officially hosted TrustTab service.
  This is the same model Let's Encrypt uses — open source, one trusted
  issuer in practice.
- **Practical build implication:** don't hardcode assumptions that only one
  instance of this will ever run. Keep the signing secret and issuer
  identity (`issuer.name`, `issuer.url`) as environment config, not
  hardcoded strings, so the separation between "the open-source code" and
  "the hosted, canonical service" is clean and explainable.
- Include a proper `LICENSE` (MIT), a real `README.md` (what this is, why it
  exists, how to get verified, how to self-host, screenshot of the badge),
  and a `CONTRIBUTING.md` even if it's brief. This repo will be judged by
  strangers on GitHub — write it like it's a public artifact, not a
  personal project, from the first commit.

---

## Stack

- **Framework:** Next.js 16 (App Router), TypeScript. Next 16 renamed
  `middleware` to `proxy` and made `params`/`cookies()`/`headers()` async-only;
  bundled docs live in `node_modules/next/dist/docs/` (see AGENTS.md).
- **Database:** Postgres via Drizzle ORM (`src/db/schema.ts`, SQL migrations in
  `/drizzle`). Local dev: any local Postgres. Hosted: Neon, provisioned through
  the Vercel Marketplace (the successor to "Vercel Postgres").
- **Auth:** Better Auth, email/password. *(Changed from NextAuth on Day 1 —
  see Decisions log.)*
- **Caching on Vercel:** Vercel's CDN caches responses marked
  `public, max-age=N` even without `s-maxage`. Endpoints that must see every
  request (rate limiting, traffic log) send `private`, and 429s send
  `no-store`. This was learned the hard way on Day 5.
- **Outbound fetches:** every fetch of a user-supplied site goes through
  `src/lib/safe-fetch.ts` (HTTPS only, public IPs only, allow-listed redirects,
  size/time caps). Do not call `fetch` on user-supplied URLs directly.
- **Styling:** Tailwind
- **HTML parsing:** `cheerio`
- **Schema validation:** `ajv`
- **Signing:** Ed25519 over RFC 8785 canonical JSON, stored in
  `site.signature` as a detached compact JWS (`header..signature`, `kid` in the
  header). Public keys at `/.well-known/jwks.json`. *(Changed from RFC 9421 on
  Day 2 — see Decisions log.)*
- **Deploy:** Vercel, redeployed continuously from day 1

One codebase. Every feature is a page or an API route in this one project.
No microservices, no external orchestration tools (no n8n, no separate
no-code dashboard builder) — everything lives here.

---

## Data model

```
users                                  -- Better Auth; password hash lives in
  id, email, name, created_at          -- accounts.password, plus sessions /
                                       -- verifications tables

sites
  id, user_id, domain, verification_token,
  ownership_verified_at, status,       -- status: pending | verified | needs_fix | failed
  created_at

manifests
  id, site_id, version, payload_json, signature,
  verified_at, expires_at, created_at

manifest_endpoints
  id, manifest_id, path, method, purpose, schema_json,
  agent_safe, requires_captcha

verification_runs
  id, site_id, manifest_id, passed,
  results_json,                        -- per-check pass/fail detail
  run_at

manifest_hits
  id, site_id, endpoint,               -- 'manifest' or 'verify'
  requester_ip, user_agent, created_at
```

---

## Pages

```
/                          landing page for TrustTab: what it is, why it exists,
                            "Get Verified" CTA
/signup, /login            auth
/dashboard                 list of user's claimed sites + status
/dashboard/[siteId]        site detail: status, endpoint checks, re-check button,
                            manifest editor, embeddable badge snippet, traffic log
/dashboard/new             claim a new domain
```

## API routes

```
POST /api/sites                        create a site, generate verification_token
POST /api/sites/[id]/check-ownership   fetch homepage, look for meta tag, mark verified

POST /api/sites/[id]/manifest          create/update manifest (validates against
                                        schema, signs it, stores it)

POST /api/sites/[id]/verify            run the verification checks (endpoint match,
                                        injection scan, SSL), write verification_runs,
                                        update sites.status

GET  /api/manifest/[domain]            public — serves the live signed manifest
                                        for a domain (this is what
                                        /.well-known/agent-trust.json redirects to)

GET  /api/verify/[verificationId]      public — { status, domain, verified_at,
                                        expires_at }. This is the canonical-registry
                                        lookup — the thing that makes a badge mean
                                        something even though the code is open source.

GET  /api/badge/[siteId].svg           public — dynamically rendered badge image,
                                        reflects live status
```

---

## Manifest schema

Full JSON Schema lives in `agent-trust.schema.json` at repo root (JSON Schema
2020-12, validated with `ajv`). It was drafted on Day 2 from the core shape
below because the original file never existed — it is a **draft** until the
owner signs off; see Decisions log.

Core shape:

```json
{
  "version": "1.0",
  "issuer": {
    "name": "TrustTab",
    "url": "https://trusttab.io",
    "verification_id": "tt_9f3k2m8x"
  },
  "site": { "domain", "verified_at", "expires_at", "signature" },
  "policy": {
    "no_prompt_injection_pledge": true,
    "agent_rate_limit": { "requests_per_minute", "captcha_exempt" },
    "content_scan": { "last_scanned", "status" }
  },
  "endpoints": [
    {
      "path", "method",
      "purpose": "lead_inquiry | booking | support_ticket | quote_request | waitlist_signup | document_upload | cancellation | account_lookup",
      "schema": { "fieldName": "string | string? | array<T> | enum[a,b,c]" },
      "agent_safe", "requires_captcha"
    }
  ]
}
```

**The `purpose` enum is the actual protocol IP.** Do not let it become
freeform per-site. New values get added centrally, in this schema file, as
new SaaS categories are onboarded — not invented ad hoc in the manifest
generator UI.

`issuer.name` is `"TrustTab"`. `verification_id` values use the prefix `tt_`.

**Domain match check is mandatory, not optional:** a manifest's declared
`site.domain` must equal the domain it's actually being served from. This is
the #1 spoofing vector (copying a verified competitor's manifest onto your
own site) — do not ship without this check.

---

## The five verification checks, in priority order

Build 1 and 2 first. Add 3-5 only if time allows — do not let them block
shipping the core loop.

1. **Endpoint existence + field match** — fetch each declared endpoint's
   page, parse with `cheerio`, confirm a `<form>` exists with input `name`
   attributes that are a superset of the declared schema fields.
2. **Injection content scan** — regex scan of page text for a short,
   specific list of prompt-injection patterns (hidden text via
   `display:none` or white-on-white styling, phrases like "ignore previous
   instructions", fake system-role markers). Keep the pattern list small —
   false positives here damage trust in the badge faster than false
   negatives do.
3. **SSL validity** — implicit: if the fetch over HTTPS succeeds, it passed.
4. **Domain match** — see above; treat as mandatory, listed here for
   completeness of the check pipeline.
5. **Expiry check** — flag if `expires_at` has passed.

Each check writes a pass/fail + short message into `results_json`. Overall
`sites.status` is `verified` only if all checks pass.

---

## What's explicitly cut for the 5-day build (do not add these back in without discussion)

- WHOIS / domain-age checks
- DNS TXT record ownership verification (using a meta tag instead —
  much lower friction for non-technical site owners)
- Automatic 30-day re-verification scheduler (ship a manual "Re-check now"
  button; add a cron job later once the check logic is proven)
- Custom badge visual design beyond one simple SVG
- Any text/audio/video AI-content detection — this is a different product,
  out of scope entirely for this repo

---

## Build order

**Day 1 — Auth + domain claim.** Sign up, log in, claim a domain, verify
ownership via meta tag check.

**Day 2 — Manifest generator.** Form to declare endpoints, validates against
schema, signs it, serves it at `/api/manifest/[domain]`.

**Day 3 — Verification engine.** Implement checks 1 and 2 above. Wire to a
"Re-check now" button that runs them and updates status.

**Day 4 — Public verify endpoint + badge + dashboard polish.** Build
`/api/verify/[id]`, the badge SVG endpoint, the traffic log (insert a row
into `manifest_hits` on every hit to the two public endpoints, display as a
table).

**Day 5 — Run it against a real domain, fix what breaks, write the README,
push to GitHub with the LICENSE.**

---

## Standing instruction

Optimize for a working end-to-end loop in 5 days over architectural purity.
It's fine to hardcode things that would normally be configurable, and it's
fine to skip abstraction layers that would matter at scale. **Flag anything
you cut for speed, in your response, so it's visible and revisitable** —
don't cut corners silently. Because this repo is public from day one, code
quality and comments should assume a stranger will read them, even where
scope is intentionally minimal.

---

## Decisions log

Deviations from the original spec above, with reasons. Add to this list
rather than silently changing direction.

- **2026-09-14 — Better Auth instead of NextAuth.** NextAuth v5 had been in
  beta for years (5.0.0-beta.32), and the Auth.js project moved under the
  Better Auth team in late 2025. NextAuth's Credentials provider is
  deliberately limited (JWT sessions only, hand-rolled sign-up). Better Auth is
  stable, supports email/password natively with DB sessions, and has a
  first-class Drizzle adapter.
- **2026-09-14 — Neon (via Vercel Marketplace) for hosted Postgres.** "Vercel
  Postgres" no longer exists as a separate product. Supabase was the
  alternative, but its bundled auth would overlap with Better Auth.
- **2026-09-14 — Drizzle ORM.** Typed queries, plain SQL migration files that
  are easy to review in a public repo, no codegen step at runtime.
- **2026-09-14 — `sites.status` is not touched by the ownership check.**
  `status` (`pending | verified | needs_fix | failed`) describes the manifest
  verification checks. Ownership is tracked only by `ownership_verified_at`.
  A site with proven ownership but no manifest is still `pending`.
- **2026-09-14 — Domain claims.** Domains are normalized (lowercase, punycode,
  leading `www.` stripped). Many accounts may hold a *pending* claim on a
  domain; only one may hold a *verified* claim (partial unique index). The
  meta tag only counts inside `<head>`, and redirects are only followed between
  `domain` and `www.domain`.
- **2026-09-14 — Schema drafted in-repo.** `agent-trust.schema.json` didn't
  exist, so it was written from the core shape above. Additions beyond that
  shape: `verification_id` pattern `^tt_[a-z0-9]{8,32}$`; `method` limited to
  GET/POST (HTML forms); field types `string number boolean email phone url
  date file`, `array<T>`, `enum[a,b]`, `?` for optional; `content_scan.status`
  `pending|passed|failed`; `no_prompt_injection_pledge` must be `true`;
  `additionalProperties: false` everywhere.
- **2026-09-14 — Ed25519 + canonical JSON instead of RFC 9421.** RFC 9421
  signs an HTTP message, so a manifest copied or cached elsewhere (e.g. to a
  customer's `/.well-known` path) would lose its signature. HMAC can't be
  verified by third parties at all. A detached JWS over RFC 8785 canonical
  JSON travels with the document, uses Node's built-in crypto, and is
  verifiable with the public JWKS. RFC 9421 response signing can be added on
  top later.
- **2026-09-14 — Manifest lifecycle.** Each publish creates an immutable
  signed version (`manifests.version` is a per-site revision counter; the
  payload's `version` is the format version `"1.0"`). A newly published
  manifest has `site.verified_at: null` and `content_scan.status: "pending"`;
  the Day 3 verification engine re-issues it once checks pass. Manifests
  expire 30 days after issue. `verification_id` is per site and stable across
  versions. Publishing requires verified domain ownership.
- **2026-09-14 — Verification engine (Day 3).** All five checks are
  implemented; `sites.status` is `verified` only if all pass. Mapping:
  injection content found → `failed`; any other failure → `needs_fix`.
  Publishing a new manifest resets status to `pending`.
  - Endpoint match requires every declared field (optional ones included) in
    a single server-rendered `<form>`. `method` mismatches are a note, not a
    failure, because JS-submitted forms often omit `method`.
  - Injection scan: three unambiguous phrase patterns anywhere (text,
    comments, text attributes), plus hidden text (inline styles / `hidden`
    only) that both names an AI and directs it. `<script>`/`<style>` are not
    scanned. Tuned against false positives with a committed fixture suite.
  - Domain match and expiry are evaluated on what
    `https://<domain>/.well-known/agent-trust.json` actually serves: correct
    `site.domain`, this site's `verification_id`, and a valid signature from
    this issuer. Redirects are allowed within the site and to exactly
    `<issuer>/api/manifest/<domain>`.
  - SSL passes if no fetch hit a certificate error and at least one HTTPS
    fetch succeeded.
  - Every run re-issues the manifest as a new signed version reflecting the
    result (`verified_at`, `content_scan`, fresh 30-day expiry), so the public
    manifest never overstates the latest run. Versions therefore grow with
    each re-check.
  - 20-second per-site cooldown between runs.
- **2026-09-14 — Link-tag fallback for manifest discovery (Day 4).** Hosted
  site builders (Base44, confirmed in production with leasetab.com; likely
  Webflow, Squarespace, Wix) reserve `/.well-known/`, which would exclude a
  large part of the ICP. Sites may instead add
  `<link rel="agent-trust-manifest" href="<issuer>/api/manifest/<domain>">`
  to the homepage `<head>`. Rules: `/.well-known/agent-trust.json` is tried
  first, and if it serves a manifest-shaped JSON document that document is
  authoritative (no fallback), because it's what well-known readers get. Only
  `<head>` links count. The href may only point to the site itself or exactly
  the issuer's manifest URL for the domain. Agents should look in both places.
- **2026-09-14 — Public registry (Day 4).** `GET /api/verify/:verificationId`
  returns the spec's fields plus `verification_id`, `issuer` and
  `manifest_url`. Public status adds a derived `expired` (last run passed but
  the current manifest is past `expires_at`). The badge is
  `/api/badge/<verification_id>.svg`, keyed by the public `tt_…` ID rather
  than the internal site UUID the spec named, so every public surface shares
  one identifier. A human-readable `/verify/:verificationId` page is what
  badges link to.
- **2026-09-14 — Traffic log.** `manifest_hits` rows are written after the
  response (`after()`) for the manifest and registry endpoints. Badge loads
  are not logged (they would be every page view of the embedding site).
  TrustTab's own verification fetches are counted. Full client IPs are stored
  as the spec says; see open questions.
- **2026-09-14 — `<meta name="agent-trust-manifest">` accepted too.** On
  leasetab.com (Base44) the ownership `<meta>` tag survived but the `<link>`
  tag never appeared in served HTML, so builders evidently differ in which
  custom head tags they keep. Both forms, same rules; `<link>` wins if both
  are present. The dashboard suggests the meta form.
- **2026-09-14 — Self-attestation for JS-rendered forms (no headless
  browser).** Owners may self-attest an endpoint. It only covers a form the
  scanner can't see on a page that loaded (2xx). It never covers a missing
  page or any other check. If all other checks pass and every endpoint is
  confirmed or self-attested, the site status is `self_declared`: a separate
  state, never shown as verified. It gets a blue badge, "Self-declared"
  labels, and the public page lists the unconfirmed forms. In the signed
  manifest: `site.verification_status` (`verified | self_declared |
  unverified`), per-endpoint `self_attested` and `verified_by` (`issuer |
  owner | null`). `site.verified_at` is set only for `verified`, so agents
  that check it are never misled.
- **2026-09-14 — Public endpoint rate limits and IP minimization.** Fixed
  window per client IP in Postgres (`rate_limit_buckets`, keyed by HMAC of
  the IP): 120/min for manifest + verify, 300/min for badges. Traffic-log IPs
  are truncated before storage (IPv4 /24, IPv6 /48) and rows are pruned after
  30 days. Pruning piggybacks on writes, so no cron is needed. Existing rows
  were anonymized by a data migration.
- **2026-09-14 — Accounts are capped at 10 sites** (`MAX_SITES_PER_USER` in
  `src/app/api/sites/route.ts`). The per-site re-check cooldown only bounds
  outbound verification traffic if the number of sites is bounded too. It is
  a natural lever for paid tiers later.
- **2026-09-14 — Better Auth rate limits use the shared Postgres limiter.**
  Its built-in `storage: "database"` keys rows as `<ip>|<path>`, which would
  store raw IPs. So `rateLimit.customStorage` (`authRateLimitStorage` in
  `src/lib/rate-limit.ts`) persists counts in `rate_limit_buckets` under an
  HMAC-hashed key, keeping Better Auth's per-path rules (e.g. 3
  sign-in/sign-up attempts per 10s). Limits hold across instances (verified
  with two servers sharing one database). Production only, per Better Auth's
  default. Note that Better Auth resolves the IP itself and puts all requests
  with no usable `x-forwarded-for` into one shared bucket, unlike the public
  endpoints, which skip limiting in that case.
- **2026-09-14 — The public `/verify/:id` page is rate-limited in
  `src/proxy.ts`** (Next 16's renamed middleware, Node.js runtime), because
  a page can't return a 429 itself. 60 requests/minute per IP through the
  shared Postgres limiter; the 429 is a small HTML page with `no-store`.
  The proxy matcher covers only that page. API routes enforce their own
  limits.
- **2026-09-14 — Email verification for new signups.** Better Auth
  `requireEmailVerification`, with links sent via Resend's HTTP API
  (`src/lib/email.ts`, no SDK). Signing in to an unverified account sends a
  fresh link. Links expire after 1 hour and sign the user in; they land on
  `/email-verified`, which also explains expired or invalid links. Sign-up
  returns the same response for already-registered emails (no account
  enumeration). Emails are sent via `after()` so responses don't wait on the
  provider. Transport: Resend if `RESEND_API_KEY` + `EMAIL_FROM` are set;
  console in `next dev` or with `EMAIL_TRANSPORT=console`; otherwise
  **disabled**, which turns verification off and logs a startup warning
  (chosen so production signups keep working until a sending domain exists).
  Accounts that existed before migration `0007` are grandfathered as
  verified.
- **2026-09-14 — Password reset, same email setup.** Better Auth's
  built-in flow: `/forgot-password` → emailed single-use link (1 hour) →
  `/reset-password`. The request gets an identical response whether or not
  the address has an account. On success, all sessions are revoked, a
  "password was changed" notice is emailed, and the email is marked verified
  (clicking a link sent to the address proves control of it). The reset page
  sends `Referrer-Policy: no-referrer` and strips the token from the address
  bar. When email is disabled, the "Forgot password?" link is hidden and
  `/forgot-password` says reset is unavailable, rather than promising an
  email that never arrives. Requests are rate-limited by Better Auth's
  built-in rule (3 per 60s per IP).

## Status at the end of the 5-day build (2026-09-14)

Live at https://trusttab-mu.vercel.app (Vercel team `trust-tab`, Neon
Postgres, auto-deploys from `main`). The full loop works end to end: claim →
ownership → signed manifest → checks → registry/badge/traffic log. The first
real domain, leasetab.com (Base44), is verified for ownership and passes the
injection scan and HTTPS. To finish, it needs the
`<meta name="agent-trust-manifest">` tag, a self-attested `/contact`
endpoint and a republish; it should then reach `self_declared`.

## Open questions

- Schema v1.0 is a draft pending owner review: especially the field-type
  grammar (base types beyond the spec's `string`) and nullable `verified_at`.
- Signing key backup/rotation: production's key is stored only as a Vercel
  sensitive env var. JWKS supports multiple keys, but there's no rotation
  tooling yet.
- Forms rendered only client-side (SPAs) can't pass endpoint match. A
  headless-browser fetch would fix this but is heavy for serverless.
- Injection scan ignores class-based CSS hiding and `<script>` content.
- JS-rendered forms: confirmed on leasetab.com (Base44). Options: a hosted
  headless-render step, or an owner-declared flag with a clearly weaker check.
  Needs a product decision.
- Rate limits trust `x-forwarded-for`, which is correct on Vercel but
  spoofable for self-hosters not behind a proxy. For serious abuse, add a
  platform/WAF rate limit.
- Email verification and password reset are **off in production** until `RESEND_API_KEY` and
  `EMAIL_FROM` (on a Resend-verified domain) are set. Accounts created
  between the grandfathering migration and that moment are unverified and
  will be asked to verify on their next sign-in.
- Manifests published before the self-attestation fields existed are served
  as-is until their next re-check, and they don't validate against the
  current schema. Only leasetab.com's is affected.
- Ownership transfer: if a verified domain changes hands, the new owner
  currently gets "already verified by another account". Needs a
  re-verification / takeover flow.

@AGENTS.md
