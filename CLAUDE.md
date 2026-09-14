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
- **Outbound fetches:** every fetch of a user-supplied site goes through
  `src/lib/safe-fetch.ts` (HTTPS only, public IPs only, allow-listed redirects,
  size/time caps). Do not call `fetch` on user-supplied URLs directly.
- **Styling:** Tailwind
- **HTML parsing:** `cheerio`
- **Schema validation:** `ajv`
- **Signing:** RFC 9421 HTTP Message Signatures with Ed25519 (same standard
  Visa's Trusted Agent Protocol uses — if this proves too heavy to implement
  cleanly in the time available, fall back to HMAC-SHA256 over canonical
  JSON and flag it as a known upgrade path, don't block the build on this)
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

Full JSON Schema lives in `agent-trust.schema.json` at repo root (already
written — port it in directly, don't rewrite it). Validate with `ajv`.

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

## Open questions

- `agent-trust.schema.json` is referenced above as "already written", but it
  was not in the repository or alongside CLAUDE.md on Day 1. It is needed
  before Day 2 (manifest generator).
- Ownership transfer: if a verified domain changes hands, the new owner
  currently gets "already verified by another account". Needs a
  re-verification / takeover flow.

@AGENTS.md
