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
- **2026-09-14 — Change password at `/dashboard/account`.** Better Auth's
  `/change-password` (requires the current password; rate-limited to 3 per
  10s). The client always sends `revokeOtherSessions: true`, with no opt-out:
  the current device stays signed in and every other session is revoked,
  matching the reset flow's "lock out anyone with the old password" rule. A
  `hooks.after` middleware emails the same "password changed" notice (worded
  for other devices) only when the change succeeded, and only if email is
  enabled. The header links to Account.
- **2026-09-14 — Delete account at `/dashboard/account`.** Better Auth
  `user.deleteUser`. Deletion cascades in the database to sites, manifests,
  endpoints, verification runs and traffic log. Public manifests, registry
  lookups and verification pages then 404, badges show "not found", and
  verified domains become claimable by other accounts. The UI lists those
  consequences (naming the user's domains) and requires typing the account
  email plus the password. Server-side, a `hooks.before` rejects
  `/delete-user` without a password: Better Auth would otherwise allow
  passwordless deletion on a session under a day old, so a stolen session
  cookie could erase an account. It is rate-limited to 3 per 10s, and an
  "account deleted" notice is emailed when email is enabled. No
  email-confirmation step, since that can't work while email is disabled.
- **2026-09-14 — Dashboard assistant (per DASHBOARD_ASSISTANT_SPEC.md).**
  Claude (`claude-sonnet-5`, override with `ASSISTANT_MODEL`) in a per-site
  chat panel. A manual tool loop (max 8 steps) over a fixed allowlist in
  `src/lib/assistant/tools.ts`: get_site_overview, crawl_site_forms,
  add/update/remove_endpoint, set_rate_limit, preview_checks,
  propose_domain_claim. All edits go to a saved draft (`manifest_drafts`,
  optimistic versioning), logged with a reason in `draft_changes` and
  highlighted in the editor. The crawler reuses the engine's fetcher and form
  parsing, and sends the model structure only (names, types, labels of at
  most 60 characters; labels withheld on injection-flagged pages).
  **Publishing is human-only, structurally:** no publish tool; ESLint
  `no-restricted-imports` plus `capabilities.test.ts` (transitive import
  graph) keep assistant code from reaching signing, store or publish routes;
  the publish endpoint signs only the stored draft whose hash the owner
  reviewed, with a single-use confirmation (`publish_confirmations`) bound to
  user, session, site and hash, 2-minute TTL; confirm, publish and the real
  re-check require same-origin browser requests. **Re-check decision (a):**
  the assistant only runs a *preview* that records nothing and signs nothing.
  The engine takes the JWKS as a parameter, and the preview fetches the public
  JWKS over HTTP. The assistant may not set the no-injection pledge (owner's
  own declaration). Domain claims are proposals the owner confirms with a
  click, one at a time. Chat history is not stored (cut for speed). No
  WebAuthn yet (user decision: revisit later).
- **2026-09-14 — Missing-form explanations lean toward JavaScript rendering.**
  The first live run on leasetab.com showed the old boolean hint
  ("client-rendered" only if under 300 characters of body text) was wrong
  for site builders that pre-render SEO text: Base44 ships about 3.4K
  characters, the hint said "not client-rendered", and the assistant told
  the owner it wasn't the JS case. `jsRenderingEvidence` now reports signals
  (app mount point, bundle scripts, form widgets, site builder, text volume)
  and an assessment of `likely_js_rendered` or `possibly_js_rendered`, with no
  "not JS" outcome. Text volume never counts against JS rendering. The prompt
  states the asymmetry: wrongly suggesting self-attestation is a minor
  detour, while wrongly ruling out JS rendering steers owners away from the
  fallback built for them, so ambiguous evidence leans JS-rendered.
  A regression fixture mirrors leasetab.com's measured structure.
- **2026-09-14 — Chrome extension, Mode 1 (per EXTENSION_SPEC.md).** In
  `extension/` (MV3, TypeScript, esbuild). Decisions:
  - **Lookup on click only:** the domain is sent only when the user opens the
    popup, with no passive browsing data. The spec said "on tab load"; the
    owner chose privacy. Permission is `activeTab` only; no `tabs`, no host
    permissions, no content scripts.
  - **Display mapping** (`src/lib/registry-display.ts`, shared with the app):
    verified → Verified (green); self_declared → Self-declared (blue, own
    state); needs_fix, expired → Needs re-check (yellow); failed → Needs
    re-check plus an explicit "content that could mislead AI agents" finding;
    pending, not_found → Not verified (grey, neutral, never red).
  - **Owner link:** a generic "Open in TrustTab" link to
    `/dashboard/open?domain=`, which routes owners to their site and others
    to a prefilled claim form. No login detection in the extension (the
    owner declined host permissions for it).
  - New public route `GET /api/verify/by-domain/:domain`, sharing
    `entryForSite` and `registryEntryJson` with the ID lookup. Only the
    verified claim is served, with exact normalized matching.
  - `src/lib/domain.ts` is now browser-safe (no `node:net`) so the extension
    reuses it.
  - The build URL is configurable (`TRUSTTAB_URL`) and defaults to
    production. Chrome Web Store publishing is not done.

- **2026-09-15 — Extension AI Check, 2a: widget detection only.** Adds
  `scripting` to the extension's permissions (still no host permissions or
  content scripts). When the user opens the AI Check tab, a self-contained
  collector runs in the active tab's main frame (isolated world). It returns
  script/iframe/resource hostnames and which known selectors match, and the
  popup matches them against `extension/src/widget-signatures.ts`, the single
  extendable provider list. There are no network calls.
  - **Deviation from the spec's wording (confirmed by the owner):** "AI agent widget detected" is used
    only for AI-native products. Live-chat vendors that sell AI add-ons
    (Intercom, Zendesk, …) are labeled "Chat widget detected" with a note
    that AI use isn't visible from the page, because stating AI as fact there
    would overclaim.
  - Signatures were checked against live vendor sites. That caught false
    positives from shared vendor hosts (`static.zdassets.com`,
    `js.usemessages.com`, `www.chatbase.co`), which now match only on the
    widget's own snippet or elements. Six entries are only doc-verified; see
    open questions.
  - 2b (LLM text estimate) and 2c are not started; they need a check-in.
- **2026-09-15 — Malformed percent-encoding returns 400** in `src/proxy.ts`.
  Vercel's edge already rejects these in production. The proxy covers local
  and self-hosted deployments, where Next.js responded 500.
- **2026-09-15 — Login returns to the page the user was headed to**
  (`?next=`, validated by `safeNextPath` against open redirects and auth-page
  loops, and carried through sign-up and the email-verification link).

- **2026-09-15 — Extension AI Check, 2b: AI-written text estimate.**
  - **Server-side model call only:** the extension posts extracted text to
    `POST /api/ai-check/text`, and TrustTab calls Claude with its own
    `ANTHROPIC_API_KEY`. The extension holds no key. The prompt is fixed and
    the output is forced through a `report_estimate` tool (assessment enum +
    one-sentence rationale), so the endpoint can't be used as a general model
    proxy. Model: `claude-haiku-4-5-20251001` (owner decision; override with
    `AI_TEXT_MODEL`), `temperature: 0`, `max_tokens: 300`.
  - **Explicit action for sending content:** widget detection (2a) still
    runs locally when the tab opens. The writing estimate runs only from its
    own "Check this page's writing" button, with a disclosure next to it.
    Extraction: `<main>`/`[role=main]`, else a single `<article>`, else
    `<body>`, skipping nav/header/footer/aside/form/button and
    `display:none`/`visibility:hidden`. Opacity is deliberately not
    checked: leasetab.com keeps ~75% of its text at opacity 0 for
    scroll-reveal animations. Sends at most 12,000 characters (about 2,000
    words) and only the text, no URL, title or cookies. Under 150 words is
    answered locally and nothing is sent.
  - **No retention:** no traffic-log row, and the text and request are never
    logged. `capabilities.test.ts` checks the import graph can't reach
    signing/publishing, write tables or log the text. Anthropic's API
    retention terms still apply.
  - **Labels** (`src/lib/ai-text/display.ts`, shared with the extension):
    "Likely AI-written (estimate)", "Can't tell (estimate)", "Likely
    human-written (estimate)". A test checks every model result carries
    "(estimate)" plus the caveat "AI-text detection is often wrong. Don't use
    this to judge or accuse anyone." It is styled weaker than 2a (dashed, no
    fill).
  - **Bias, pinned in the prompt and enforced in code:** wrongly labeling
    human writing as AI-written is the worse mistake. The first live test
    showed the prompt alone didn't hold: Haiku called leasetab.com's
    marketing copy likely_ai on style alone ("templated structure, generic
    marketing phrases"). So likely_ai now requires the model to quote at
    least one direct artifact of AI generation (leftover chatbot phrasing,
    unfilled placeholders, prompt remnants) in `ai_artifacts`.
    A second live test showed Haiku offering stock phrases ("fast-paced
    digital landscape") as artifacts. So `applyEvidenceRule` keeps likely_ai
    only if a quote appears verbatim in the page text **and** matches the
    explicit, extendable pattern list in `src/lib/ai-text/artifacts.ts`
    (chatbot openers/sign-offs, "as an AI language model", unfilled
    `[placeholders]`, knowledge-cutoff mentions). Otherwise the result is
    "Can't tell" with a fixed rationale, and the verified quotes are shown as
    evidence. Code can verify a quote exists and looks like an artifact, not
    that it truly is one (an article may quote a chatbot).
    Consequence: fluent AI text with no artifacts comes out "Can't tell".
    The owner confirmed this low-recall tradeoff as final (2026-09-15),
    given the harm asymmetry.
    `prompt.test.ts`, `estimate.test.ts` and `artifacts.test.ts` pin this,
    including the live-test phrases as regressions. The same page's result
    also moved between prompt versions (leasetab.com: likely_ai, then
    likely_human), which is expected of an estimate.
    Page text is wrapped in `<page_text>` as untrusted data (it can't close
    the tag). A page can still try to steer its own estimate; that's
    accepted, given the estimate labeling.
  - **Limits** (owner-approved), via the shared Postgres limiter: 10/hour and
    30/day per IP, then a global 1,000/day budget (`AI_CHECK_DAILY_CAP`, shared with 2c,
    returns 503). New `enforcePaidRateLimits` fails closed, rejecting
    requests with no client IP, unlike the free public endpoints. The owner
    sets a monthly spend limit in the Anthropic Console as the backstop.
  - **Limiter fixes found while planning:** buckets now store `expires_at`
    (migration 0009), and pruning deletes expired rows. Previously every row
    older than an hour was deleted, which would have silently reset day-long
    windows. The column has a default so code deployed before the migration
    keeps working during a deploy.
  - The Web Store listing will need a privacy policy covering 2b before
    publishing. 2c (images) is not started.

- **2026-09-15 — Extension AI Check, 2a addition: AI applications by
  domain.** A third signature kind in the same list
  (`extension/src/widget-signatures.ts`): `ai_application`, matched on the
  page's own hostname via `pageDomains` (the domain or a subdomain of it).
  Shown as "Native AI application detected: [name]", stated as fact like the
  rest of 2a, since it is exact domain matching. The label notes it
  identifies the site only and says nothing about whether text on the page is
  AI-written, keeping it distinct from the 2b writing estimate. The page's
  own host is matched only against `pageDomains`, so a site that merely loads
  a script from an AI app is never reported as one; tests pin that and
  lookalike domains. Entries (all checked live on 2026-09-15): Claude,
  ChatGPT, Google Gemini, Google AI Studio, NotebookLM, Microsoft Copilot,
  Perplexity, Grok, Meta AI, DeepSeek, Mistral Le Chat, Qwen Chat, Poe,
  Character.AI.
- **2026-09-15 — Extension AI Check, 2c: image check.** Owner-approved
  plan, with every step triggered by a click:
  - **Flow:** "Find images on this page" lists visible images of at least
    200px, in page. Picking one reads its bytes and checks provenance
    locally. "Ask for an estimate" (Tier 2) is a separate button, offered
    only without verified credentials.
  - **Reading bytes:** in page first (same origin, CORS, blob:), then a popup
    fetch if an optional host permission for that image's origin is already
    granted. Otherwise a "Allow reading images from this site" button calls
    `chrome.permissions.request` for that one origin. Popup fetches never
    send cookies.
  - **Tier 1 runs in the browser (feasibility check done first):**
    `@contentauth/c2pa-web` 0.15's worker loader requires an `https:` worker
    URL and otherwise creates a `blob:` worker, and the MV3 extension CSP
    allows neither. The reader also needs `FileReaderSync` (worker-only). So
    the extension uses the lower-level `@contentauth/c2pa-wasm` 0.12 in its
    own module worker (`c2pa-worker.js`), plus the 8.4 MB c2pa-rs
    WebAssembly file. It was verified under the MV3 default CSP with
    Trusted, Valid (untrusted signer), Invalid (tampered) and no-manifest
    test files.
  - **Trust lists** (committed in `extension/trust/`, refreshed by
    `extension/update-trust-lists.mjs`): the official C2PA Trust List first.
    If the signer isn't on it, the interim contentcredentials.org list
    (anchors, allowed hashes, EKU config), which is labeled as interim and
    being phased out. Lists can go stale between updates.
  - **Three visual tiers plus "nothing found"** (owner addition): verified
    (solid violet edge and fill, filled chip), unverified (hatched edge, no
    fill, outlined chip; covers untrusted signers, invalid credentials and
    unsigned metadata), estimate (dashed, dashed chip), and none (plain).
  - **Verified wording** states who signed and what they state. The popup
    also says "The signature proves who made these statements and that the
    file hasn't changed since. It doesn't prove the statements are true."
    IPTC digital source types map to plain phrases (`trainedAlgorithmicMedia`
    → "created with generative AI"; `algorithmicMedia` is explicitly "not
    described as generative AI"). Credentials that don't mention AI say so
    instead of implying no AI. Invalid credentials say they don't mean the
    image is AI-generated.
  - **Unsigned metadata** (owner decision: show it, clearly unverified)
    comes from an explicit marker list in `extension/src/provenance.ts`:
    IPTC DigitalSourceType generative-AI codes, Stable Diffusion WebUI
    parameters, ComfyUI workflows, AI generator names in
    CreatorTool/Software.
  - **Tier 2:** `POST /api/ai-check/image`, JPEG body at most 1.5 MB, which
    the extension downscales to at most 1024px (this also drops metadata).
    Model `claude-haiku-4-5-20251001` (`AI_IMAGE_MODEL`). There are only two
    outcomes, "Possibly AI-generated (estimate, no verified metadata found)"
    and "No clear signs of AI generation (estimate, no verified metadata
    found)", and it never says "real". `applyArtifactRule` (shared, applied
    by server and extension) keeps possibly_ai only with a concrete artifact
    from `VISUAL_ARTIFACTS` (garbled text, malformed anatomy, impossible
    geometry, inconsistent reflection/shadow, visible generator watermark),
    shown as "Model reports: …" for the viewer to check. The prompt pins the
    bias (wrongly flagging real photos or artwork is worse; style is never
    evidence), forbids identifying people, and treats text in images as
    untrusted. The image isn't logged or stored.
  - **Limits:** `ai-image-hour` 10 and `ai-image-day` 30 per IP. The global
    budget is shared with 2b as `ai-check-all` (`AI_CHECK_DAILY_CAP`,
    renamed from `AI_TEXT_DAILY_CAP`; resets the shared counter once).
    Limit modules moved to `src/lib/ai-check/`.
  - **Live results (2026-09-15):**
    - **Tier 1 on real-world signed files** (contentauth/verify-site
      fixtures): an Adobe Firefly image comes out verified, "created with
      generative AI"; a Photoshop export and a Cloudinary image are also
      verified. All three chain only to the interim list, so the fallback
      is needed today. An Adobe Lightroom/Photoshop file with an untrusted
      certificate shows as unverified.
    - **Tier 2 on production:**
      - A real landscape photo, the Mona Lisa, and Bosch's *Garden of
        Earthly Delights* came back no_clear_signs, so no false positives.
      - Three DALL·E images came back possibly_ai with genuine artifacts:
        garbled text, melted hands, puzzle pieces that don't connect, and
        the DALL·E corner watermark (after naming it in the definition).
      - One AI image was missed, as low recall is expected.
    - **Prompt fix after the live run:** the model had cited "puzzle pieces
      floating in the sky" (subject matter), so the prompt now says surreal
      subject matter isn't an artifact (pinned). It can still list a weaker
      extra artifact next to a genuine one.
  - **Not covered:** Google SynthID (needs Google's detector), CSS background
    images, and images inside iframes.

- **2026-09-15 — AI Check additions (AI_CHECK_ADDITIONS_SPEC.md): safety
  checks and summary badge.** Addition 1 (native AI platforms) shipped
  earlier the same day; see the entry above.
  - **Addition 2, sensitive-info request** (`extension/src/sensitive-request.ts`):
    fires only when one block of chat/form text both asks for something
    credential-shaped and applies urgency. Explicit pattern lists (the only
    place they're defined), plus negation patterns so security notices ("we
    will never ask for your password") never fire. The finding quotes the
    page's own words and states what was found, never a verdict. Limitation:
    chat widgets that render in cross-origin iframes (Intercom, Drift) can't
    be read, so this sees only same-document chat and forms.
  - **Addition 3, fake countdown timer: NOT BUILT** (spec asked for a
    feasibility call first; the owner confirmed the cut as final on
    2026-09-17, on the grounds that the check couldn't reliably tell a real
    deadline from a fake one). Two blocking reasons. (a) The test as specified
    has the wrong sign for the common case: "evergreen" timers store a
    per-visitor deadline in localStorage or a cookie, so they *survive*
    reloads and would be reported as genuine, while a real server-rendered
    deadline that is re-rendered per load can look like a reset. (b) The
    architecture can't run the test: the extension only acts on click, keeps
    no state between popup opens, and reloading the user's tab would be a
    destructive side effect (lost form input, re-submitted posts). Detecting
    that a countdown is *running* is easy; deciding it is *fake* is not
    reliable, and a false read here would undermine the evidence-based trust
    every other check depends on. A per-visitor-deadline check (countdown
    displayed + a stored deadline matching it) was considered and rejected
    too: genuine per-user deadlines exist (cart holds, booking holds, exam
    timers), so it would flag real ones.
  - **Addition 4, domain lookalike** (`extension/src/lookalike.ts`,
    `lookalike-brands.ts`): registrable-domain comparison against a bundled
    brand list, with punycode decoding, homoglyph/confusable normalization
    (Cyrillic and Greek, digit substitutions, rn→m, vv→w) and
    Damerau-Levenshtein distance. Three match kinds: character substitution,
    near-miss ending, and brand-name-in-another-domain. A brand's own domains
    and subdomains never match, and `commonWord` brands (apple, target,
    chase, visa...) are excluded from name-in-domain matching so
    "apple-pie-recipes.com" stays clean. Tests pin the false-positive cases.
  - **Summary badge** (`extension/src/safety-badge.ts`): green / yellow / red
    as a mechanical count of *distinct* checks that fired (0 / 1 / 2+).
    Severity is never weighed, two findings from the same check stay yellow,
    and all findings are listed under the badge.
  - **Deviation from the spec, flagged:** the spec's yellow tier lists "or a
    flagged widget" as a trigger. Widget and AI-application detection do not
    feed the badge, because the same spec forbids folding AI use into a
    safety signal ("No 'AI-made = suspicious' framing"). Only Additions 2 and
    4 feed it today, so red currently requires exactly that pair.
  - **Colour note:** this badge introduces green/amber/red inside AI Check,
    while Mode 1 verification deliberately avoids red (an unverified site is
    an unknown, not a warning). The two live in separate tabs with different
    shapes, and the badge answers "did these checks find anything", not "is
    this site verified".

- **2026-09-17 — Agent traffic detection (AGENT_TRAFFIC_DETECTION_SPEC.md).**
  The spec asked for a feasibility check per hosting category first. What it
  found, and what was built on it:
  - **No-code platforms expose nothing server-side (checked, not assumed).**
    On leasetab.com (Base44) every unknown path returns the app's HTML, and
    owner code runs only at `/functions/<name>`, a separate endpoint namespace
    (confirmed live: `/functions/x` returns "Backend function not found").
    Page requests never reach code the owner controls. Base44's own analytics
    are client-side (a `/track-click` beacon), so an agent fetching raw HTML
    leaves no trace the owner can see either. This is a permanent limitation
    for a meaningful part of the ICP, not a temporary gap.
  - **"Behind Cloudflare" does not mean the owner has Cloudflare.**
    leasetab.com resolves to Render (`base44.onrender.com` →
    `…cdn.cloudflare.net`), so that Cloudflare zone belongs to Render/Base44.
    The owner controls DNS at their registrar only.
  - **Cloudflare's paid classification is out of reach for the ICP.**
    `cf.bot_management.signed_agent` requires Enterprise with Bot Management;
    it is unavailable on Free, Pro and Business. So the reuse is Cloudflare's
    open-source implementation, not their API: the extension-style "reuse over
    rebuild" still applies, one level down.
  - **Tier 1 uses `web-bot-auth` (Apache-2.0), not a hand-rolled RFC 9421
    verifier.** Proven end to end before building: a signed request verifies,
    and the same signature replayed against another host is rejected because
    the signature covers the target authority. Directory discovery goes
    through `safe-fetch` (the `Signature-Agent` header is attacker-controlled,
    so this would otherwise be an SSRF and amplification vector), with a
    6-hour cache, a 15-minute negative cache, and a per-instance budget of 60
    directory fetches per 10 minutes. Only Ed25519 is supported, which is what
    the published directories use.
  - **Coverage, measured on 2026-09-17:** `chatgpt.com` publishes 1 key and
    `agent.bot.goog` publishes 5. Perplexity and Anthropic publish nothing at
    their obvious hosts. The UI says plainly that most agent traffic is
    unsigned and that no signature means nothing.
  - **Tier 2 is an estimate, from two signals:** a known agent user agent
    (`src/lib/agent-traffic/agents.ts`) and an IP inside a range the operator
    publishes (`ranges.json`, refreshed by
    `scripts/update-agent-ranges.mjs`; OpenAI, Google and Perplexity publish
    these, Anthropic doesn't). **Deliberately not built:** generic
    AWS/GCP/Azure datacenter matching. Those lists are megabytes, and cloud
    origin is exactly where uptime monitors, scanners and consumer VPNs live,
    so it would flag people as agents. TrustTab's own fetches get their own
    tier so a site's checks aren't counted as visitors.
  - **Order built (owner decision):** registry traffic first, since it works
    for every customer with nothing installed — requests to a site's manifest
    and registry entry arrive at TrustTab. Then opt-in site-wide collection.
  - **Opt-in, per site.** `sites.agent_traffic_enabled_at` plus a token whose
    secret is stored only as a SHA-256 hash and shown once. Site-wide rows
    live in their own table (`site_agent_hits`), not mixed into
    `manifest_hits`, so the privacy boundary is visible in the schema.
    Disabling invalidates the token; collected rows age out under the same
    30-day retention. Visitor IPs reach TrustTab (they must, to match
    published ranges), are used in memory, and are stored coarsened (/24,
    /48) exactly like the existing traffic log.
  - **Collectors** (`collectors/`): a Cloudflare Worker and a Node/Next.js
    function, both first-class. They forward only the URL, method, IP, user
    agent and the three signature headers, never cookies, query strings or
    content, and report after the response. Verification stays server-side so
    there is one implementation.
  - **No-code customers get the honest option, not a dead end:**
    `collectors/README.md` documents moving DNS to their own Cloudflare zone
    in front of the host (Render documents this pattern), with the trade-offs
    stated. It is opt-in instructions, never the default. It includes a worked
    example for leasetab.com with its real records (Namecheap nameservers,
    apex A to Render's 216.24.57.1, `www` CNAME to `base44.onrender.com`, no
    AAAA), the grey-cloud-first ordering that Render's certificate issuance
    needs, and how to undo it.
  - **The panel never claims a human.** There is no "human traffic" figure,
    because nothing here can establish one; unmatched requests are
    "Unclassified" with a note saying exactly that.

- **2026-09-17 — AI Check, Addition 5: known-product brand mismatch.** From
  real adversarial testing by the owner: `hermesagents.net` presents itself as
  "Hermes Agent", the name of Nous Research's unaffiliated open-source agent
  at `hermes-agent.nousresearch.com`. 2a correctly said "no known widgets
  found" (that product was never on the widget list), so this is a different
  check, not a bug fix.
  - **What it checks:** the page's own claimed identity (title's leading
    segment, `og:site_name`, `h1`, JSON-LD `name`) against
    `extension/src/known-products.ts`, firing only when the name matches a
    listed product and the domain isn't one of that product's.
  - **Distinct from Addition 4:** that one catches misspellings of a known
    *domain* (`paypa1.com`); this one catches a claim to a known *product
    name* from an unrelated domain.
  - **Guards against false positives:** the product's own domains and
    subdomains are silent; platform domains where anyone can publish (GitHub,
    Reddit, Medium, Hugging Face, vercel.app…) are silent; a page that merely
    mentions a product ("How to install Hermes Agent") doesn't match, because
    only the leading title segment counts; one-word product names need two
    independent signals; and products named after ordinary words (Cursor,
    Devin, Manus, Lovable, Windsurf, Comet, Gemini) are deliberately left off
    the list, since another business may legitimately use those names. A test
    asserts every listed product's own domains stay silent.
  - **Wording:** states the discrepancy and nothing else. A test forbids
    "scam", "fake", "fraud" and "impersonation" in the output, and the popup
    says a shared name can be an unrelated product, a reseller or someone
    trading on the name, and that this check can't tell which.
  - **Severity:** one concrete check, so it is yellow alone and contributes to
    red only alongside another independent check, per the badge rule.
  - **Committed regression fixture:** `extension/src/fixtures/hermes-agent.json`
    holds both pages' identity fields as captured live on 2026-09-17 (metadata
    and headings only, not page content). Tests pin both directions: the
    unrelated domain is reported, and the real product's own site and its
    vendor's domain never are.
  - **Verified in the installed extension** by the owner on 2026-09-17:
    hermesagents.net flags yellow with the intended wording, and
    hermes-agent.nousresearch.com stays silent.
  - **Completeness caveat, in the UI as well as here:** the list is short and
    the space of AI products is large, so silence is not evidence a product is
    genuine. Like the widget signatures, brand list and C2PA trust lists, it
    goes stale and needs periodic review.

- **2026-09-18 — Declared intent (AGENT_TRAFFIC_DETECTION_SPEC addition).**
  Binds an agent's stated scope to the Web Bot Auth identity already shipped.
  - **Feasibility check first, and it passed cleanly.** `web-bot-auth`'s
    `sign()` takes `additionalComponents`, and `verify()` returns the
    `components` it actually covered. Proven against the library, not assumed
    (`intent.test.ts` pins all four): a covered declaration verifies and is
    listed among the signed components; altering it after signing fails
    verification; removing it fails with "Missing field"; and a declaration
    **appended** to someone else's valid signature leaves the signature valid
    while the covered-component list shows it was never signed.
  - **The rule that follows:** a declaration counts only when the signature
    covered it. `verifyWebBotAuth` checks the covered-component list and drops
    anything else, because otherwise an unsigned header sitting beside a
    signed identity would look verified when it isn't.
  - **Vocabulary is the manifest's own `purpose` taxonomy**
    (agent-trust.schema.json via `PURPOSES`), not a second one. Header shape:
    `Intent-Declaration: purpose="booking"; scope="/schedule-tour"`, repeated
    keys allowed, unknown purposes dropped rather than invalidating the whole
    declaration.
  - **Declaring is optional.** A verified agent that declares nothing is
    ordinary and is never ranked below one that declares; the UI says so.
  - **Mismatch is defined narrowly:** the path falls outside a declared scope,
    or the site itself publishes that path under a purpose the agent didn't
    declare. A path the site publishes nothing about is not a mismatch, since
    most of a site isn't in its manifest. Stored on `site_agent_hits`
    (`declared_intent`, `scope_mismatch`); registry hits store the declaration
    only, as TrustTab's own endpoints aren't in a site's taxonomy.
  - **Wording:** a test forbids "malicious", "attack", "compromised", "abuse",
    "unauthorised" and similar, the same way Addition 5 forbids "scam". The UI
    says a mismatch can be a misconfigured agent, a redirect or a deliberate
    deviation, and that this can't tell which.
  - **Collectors had to change**, and this was easy to miss: they forwarded
    only the user agent and three signature headers, so a signed declaration
    would never have reached TrustTab from a real site. Both now forward
    `intent-declaration`, and `collectors.test.ts` pins the forwarded list in
    both directions (what must be sent, and that cookies/authorization/referer
    must not be).
  - **Enforcement mode is NOT built, and when it is, it must fail open**
    (owner decision, 2026-09-18): a strict timeout, and if TrustTab doesn't
    answer in time the request proceeds anyway. TrustTab's own latency or
    downtime must never be able to take a customer's site down. The decision
    on whether to build enforcement at all is separate and still open.
  - **Why enforcement needs that decision:**
    Both collectors report *after* the response has been served
    (`ctx.waitUntil`, unawaited fetch), which is what keeps them from slowing
    or breaking a site. Blocking on mismatch would require an inline,
    request-path integration that waits on TrustTab before responding — a
    different shape with real availability risk for the customer's site. The
    spec calls enforcement opt-in and off by default; this is flagged for a
    check-in rather than built.
  - **Live-tested end to end in production (2026-09-18).** TrustTab isn't an
    agent and has no key directory, so a throwaway test agent identity was
    published at `/.well-known/http-message-signatures-directory`, three real
    signed requests were sent to the live deployment, and the directory was
    removed in the next commit. Its private key never left the machine that
    generated it and was never committed. Results, straight from the
    production database:
    - signed with the declaration covered → `verified`, identity
      `https://trusttab-mu.vercel.app`, `declared_intent = "booking under
      /schedule-tour"`;
    - the same signature with the declaration altered in flight →
      `unclassified`, "a signature was present but could not be verified";
    - a valid signature that never covered a declaration, with one appended
      afterwards → identity still `verified`, `declared_intent = null`.

    So the tamper-evidence and the covered-components rule both hold over the
    wire, against a real directory fetch, not only in tests.

- **2026-09-18 — Agent session timeline and owner-registered agents
  (AGENT_TRAFFIC_DETECTION_SPEC additions).** Both are dashboard-only and
  behind the existing per-site ownership check: nothing here appears on the
  public verify page, the badge or the manifest, because a ranking of who
  crawls a site is the owner's operational data, not a public trust claim.
  `access.test.ts` pins that the public surfaces don't import the new queries.
  - **Timeline.** A ranked list of agents by request volume over 24h / 48h /
    7d / 30d (`AGENT_TRAFFIC_WINDOWS`), and per-agent, the requests in order
    with endpoint, method, timestamp and whether the path fell inside the
    agent's declared scope (reusing the declared-intent mismatch styling, and
    its wording rules). Ranking covers the identified tiers only — verified,
    likely automated and owner-identified — since unclassified traffic has no
    agent to rank and TrustTab's own checks aren't visitors. `method` is now
    stored on `site_agent_hits`; rows collected before this are blank there.
  - **Two plain readouts, then one heuristic.** The detail view states the
    facts first ("90 requests in 53 seconds, 90 distinct pages"). The only
    judgment is "Unusually high request rate (heuristic)", and it fires only
    past a documented threshold: **60 requests in any rolling 60-second
    window**, measured as a peak rather than an average so a short burst
    isn't averaged away over a long window. The number is defensible rather
    than arbitrary — it is above sustained human browsing, and an order of
    magnitude above the one-request-per-second-and-slower rates that
    `Crawl-delay` conventions ask crawlers for. The UI says ordinary traffic
    can reach it too (many assets on one page, prefetching), so the flag
    points at the timeline rather than concluding anything.
  - **The word "scraper" is not used, and a test forbids it** along with
    "attack" and "malicious", the same way Addition 5 forbids "scam" and
    declared intent forbids "compromised". Rate and breadth are facts; intent
    isn't visible from them.
  - **Owner-registered agents are a fourth tier** (`owner_identified`), for
    the case neither existing tier can reach: an agent the owner built on a
    no-code platform publishes no signing keys and runs from no published
    crawler range. The owner registers a signal — a user-agent substring, an
    IP or CIDR, or the `x-trusttab-agent` header — and matching traffic is
    labelled "Your agent: <their name>" instead of sitting in unclassified.
  - **Not adversarial, and the UI says so** (owner framing, 2026-09-18): the
    owner is tagging their own known traffic, so this doesn't need the
    evidentiary bar external declarations do. What it does need is honesty
    that it's a self-configured label: the tier reads "Your own agents (you
    labelled these)" and the panel says it's "a label you set, not something
    TrustTab verified", only as good as the signal it matches, since a user
    agent can be copied by anyone and an IP can be shared by an office.
  - **A label can never outrank a signature.** Both recorders apply
    `owner_identified` only when the tier isn't already `verified` or
    `trusttab`, so registering `Mozilla/5.0` can't relabel a cryptographically
    verified agent — or every visitor — as the owner's own bot. An integration
    test pins it. User-agent fragments under 4 characters are rejected for the
    same reason, and sites are capped at 20 registered agents.
  - **`x-trusttab-agent` is a fixed header name**, not per-site configuration,
    so the collectors stay a fixed forwarded list (now six headers) rather
    than something each site has to configure. Registration routes require
    both same-origin browser requests and site ownership.

## Status at the end of the 5-day build (2026-09-14)

Live at https://trusttab-mu.vercel.app (Vercel team `trust-tab`, Neon
Postgres, auto-deploys from `main`). The full loop works end to end: claim →
ownership → signed manifest → checks → registry/badge/traffic log. The first
real domain, leasetab.com (Base44), has proven the full loop including
self-attestation and is `self_declared`.

Post-build additions, all live: account email verification, password reset
and change, and deletion (email sending is off until a Resend key and domain
are configured), Postgres-backed rate limiting, and the dashboard assistant.
The assistant was verified with the live model on leasetab.com: it drafts
only from real forms, reports JS-rendered forms as "probably built by
JavaScript" with the observed signals, never guesses fields, and cannot
publish.

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
- The known-AI-product list (`extension/src/known-products.ts`) is small and
  goes stale as products launch, rename or change domains. It can only catch
  impersonation of products on it, and a missing domain for a listed product
  would make that product's own page look like an impersonation, so additions
  need every legitimate domain. Needs periodic review.
- The spoofed-brand list for the domain-lookalike check
  (`extension/src/lookalike-brands.ts`) goes stale: brands change domains and
  new ones get targeted. It needs periodic review, like the widget signatures
  and the C2PA trust lists. It is also deliberately small, so most lookalike
  domains in the wild will not match any brand on it.
- Extension widget signatures: Crisp, Drift, HubSpot chat, Freshchat,
  Voiceflow and Ada are verified only against their embed documentation, not
  live-tested, because their own sites don't run their standard widget.
  Eventually live-test each against a real customer site. Not urgent.
- **GDPR/DPA is a hard requirement before this is promoted beyond
  leasetab.com** (owner decision, 2026-09-17), not a deferred item.
  Logging visitor traffic carries its own compliance obligations
  (GDPR and similar) that TrustTab hasn't dealt with before: site-wide
  collection means a site owner sends their visitors' data to TrustTab, which
  is a processor relationship. The build covers the technical side (opt-in,
  disclosure before enabling, IP coarsening, 30-day deletion) and the UI tells
  owners to check their own privacy notice, but there is no DPA, no data
  processing terms, and no region controls. Worth legal review before this is
  promoted to customers.
- The agent IP ranges (`src/lib/agent-traffic/ranges.json`) and the agent
  user-agent list go stale as operators change infrastructure; re-run
  `scripts/update-agent-ranges.mjs` periodically. Anthropic publishes no IP
  ranges, so ClaudeBot is only ever a user-agent match today.
- Generic datacenter/cloud IP matching (AWS, GCP, Azure) is deliberately not
  implemented; see the decision entry. If it is added later it needs a
  separate, weaker label than the operator-published ranges.
- The high-request-rate flag's threshold (60 requests in any 60-second
  window, `HIGH_RATE_PER_MINUTE` in `src/lib/agent-traffic/timeline.ts`) is a
  documented judgment call, not a measured one. It has not been calibrated
  against real traffic on a busy site, where prefetching or an asset-heavy
  page could reach it legitimately. Revisit once there is production traffic
  to measure; it is deliberately one constant in one place.
- Owner-registered agent signals are self-declared labels, and TrustTab has
  no way to check them. A shared office IP or a common user-agent fragment
  would label other people's traffic as the owner's own agent. The minimum
  fragment length and the verified/trusttab precedence bound the damage, but
  the label is only ever as good as the owner's own signal.
- The agent timeline shows at most 500 requests per agent per window. A
  busier window is truncated (the UI says so), and the volume counts above it
  stay complete. Paging is not built.
- Ownership transfer: if a verified domain changes hands, the new owner
  currently gets "already verified by another account". Needs a
  re-verification / takeover flow.

@AGENTS.md
