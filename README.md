# TrustTab

**Verified, agent-ready forms.** TrustTab lets a website declare which of its
forms are safe and correctly structured for an AI agent to act on (a contact
form, a booking page, a support ticket), verifies that claim automatically, and
issues a badge that anyone can check against a public registry.

> **Status: early development.** This repository is being built in the open.
> Today it covers accounts, domain-ownership verification and signed
> manifests; verification checks and the badge are next (see [Roadmap](#roadmap)).

## Why this exists

AI agents are starting to fill in forms on people's behalf. That raises two
questions a site owner currently has no standard way to answer:

1. **Can an agent use this form correctly?** Which fields it takes, what they
   mean, and whether the form is intended for automated use at all.
2. **Is the page safe for an agent to read?** Hidden text and "ignore previous
   instructions"-style content can hijack an agent that visits the page.

TrustTab gives sites a way to publish those answers in a machine-readable
manifest at `/.well-known/agent-trust.json`, and gives agents (and people) a way
to confirm the manifest was independently checked and is still current.

### What TrustTab is not

TrustTab is **not** an agent-identity or payments protocol. Efforts like Visa's
Trusted Agent Protocol and Google's AP2 verify that an *agent* is real and
authorized to act for someone. TrustTab is complementary: it verifies the
*site* the agent is about to interact with.

## How verification works

1. **Claim your domain.** Sign up, enter your domain, and add the generated tag
   to the `<head>` of your homepage:

   ```html
   <meta name="agenttrust-verify" content="YOUR_TOKEN">
   ```

   Click **Check now**. TrustTab fetches `https://your-domain/` and confirms
   the tag is present. *(Available today.)*

2. **Declare your agent-safe endpoints.** Describe each form: its path,
   method, purpose (from a fixed, centrally maintained list such as
   `lead_inquiry` or `booking`) and field schema. TrustTab signs the manifest
   and serves it. *(Available today — checks come next.)*

3. **Get checked.** TrustTab confirms each declared form exists with the
   declared fields, scans the page for hidden prompt-injection content,
   checks HTTPS, and makes sure the manifest's domain matches the domain
   serving it. Passing sites get a badge backed by a public lookup endpoint.
   *(In progress.)*

## The manifest

The manifest format is defined by [`agent-trust.schema.json`](./agent-trust.schema.json)
(JSON Schema 2020-12, **version 1.0 draft**). An abbreviated example:

```json
{
  "version": "1.0",
  "issuer": { "name": "TrustTab", "url": "https://trusttab.example", "verification_id": "tt_3v5urc2st37r" },
  "site": {
    "domain": "acme-plumbing.com",
    "verified_at": null,
    "expires_at": "2026-10-14T18:00:00.000Z",
    "signature": "eyJhbGciOiJFZERTQSIsImtpZCI6Ii4uLiJ9..3q2-7w..."
  },
  "policy": {
    "no_prompt_injection_pledge": true,
    "agent_rate_limit": { "requests_per_minute": 20, "captcha_exempt": true },
    "content_scan": { "last_scanned": null, "status": "pending" }
  },
  "endpoints": [
    {
      "path": "/contact",
      "method": "POST",
      "purpose": "lead_inquiry",
      "schema": { "name": "string", "email": "email", "service": "enum[repair,install]", "notes": "string?" },
      "agent_safe": true,
      "requires_captcha": false
    }
  ]
}
```

`verified_at: null` and `content_scan.status: "pending"` mean the manifest is
signed but the verification checks haven't passed yet. **Agents should only
treat a manifest as verified when `verified_at` is set and `expires_at` is in
the future.**

A site's live manifest is served at `<issuer>/api/manifest/<domain>`. Site
owners make it available at `https://<domain>/.well-known/agent-trust.json` by
redirecting that path to the issuer.

### Verifying a signature yourself

`site.signature` is a detached compact JWS ([RFC 7515](https://www.rfc-editor.org/rfc/rfc7515))
using Ed25519 (`alg: EdDSA`). To verify:

1. Split the signature into `header`, an empty segment, and `sig` on `.`.
2. Decode `header` (base64url JSON) and read `kid`.
3. Fetch `<issuer.url>/.well-known/jwks.json` and pick the key with that `kid`.
   Only trust keys from an issuer you trust (see below).
4. Remove `site.signature` from the manifest and serialize the rest with
   [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JSON canonicalization.
5. Verify `sig` over the ASCII bytes `header + "." + base64url(canonical JSON)`.

Any standard JOSE library that supports detached payloads and EdDSA can do
steps 4–5.

## Open source and the hosted registry

The code is MIT-licensed. Anyone can read it, fork it and run their own
instance. A badge, though, only means as much as the registry it resolves
against. A self-hosted instance issues badges that verify against *its own*
keys, and the canonical TrustTab badge is the one that resolves against the
official hosted service. It's the same model as Let's Encrypt: open code, with
one widely trusted issuer in practice. Issuer identity and signing keys are
configured through environment variables, never hard-coded.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript
- Postgres with [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://www.better-auth.com) (email/password)
- Tailwind CSS
- [cheerio](https://cheerio.js.org) for HTML parsing, [undici](https://undici.nodejs.org) for hardened outbound fetches
- [Ajv](https://ajv.js.org) for schema validation; Node's built-in `crypto` for Ed25519 signing

## Self-hosting / local development

### Prerequisites

- Node.js 20.9 or newer
- A Postgres database (local, or hosted: Neon, Supabase, RDS…)

### Setup

```bash
git clone <this repo> trusttab && cd trusttab
npm install
cp .env.example .env.local   # then fill in the values
npm run db:migrate           # create tables
npm run dev                  # http://localhost:3000
```

`.env.local` needs:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `BETTER_AUTH_SECRET` | Session signing secret. Generate one with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public base URL of the deployment, e.g. `http://localhost:3000` |
| `TRUSTTAB_ISSUER_NAME` | Issuer name written into signed manifests |
| `TRUSTTAB_ISSUER_URL` | Public `https://` base URL of this instance, written into manifests |
| `TRUSTTAB_SIGNING_PRIVATE_KEY` | Ed25519 signing key. Generate with `npm run keys:generate` and back it up |
| `AGENTTRUST_VERIFY_TOKEN` | *Optional.* Makes this deployment publish its own verification tag so it can claim its own domain |

### Deploying to Vercel

1. Import the repository into Vercel.
2. In the project's **Storage** tab, add a Neon Postgres database. This sets
   `DATABASE_URL` for you.
3. Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUSTTAB_ISSUER_NAME`,
   `TRUSTTAB_ISSUER_URL` and `TRUSTTAB_SIGNING_PRIVATE_KEY` under
   **Settings → Environment Variables**.
4. Run migrations against the production database from your machine:
   `vercel env pull .env.production.local`, then
   `DATABASE_URL=… npm run db:migrate`.
5. Deploy.

### Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (includes type checking) |
| `npm test` | Unit tests (Node's built-in test runner) |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm run keys:generate` | Print a new manifest-signing key |
| `npm run db:generate` | Generate a SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database with Drizzle Studio |

## Project layout

```
src/
  app/                  pages and API routes (App Router)
    api/auth/[...all]   Better Auth endpoints
    api/sites/          domain claims, ownership checks, manifest publishing
    api/manifest/       public manifest lookup
    .well-known/        public signing keys (JWKS)
    dashboard/          signed-in UI
  components/           UI components
  db/                   Drizzle schema and client
  lib/
    auth.ts             Better Auth config and session helpers
    domain.ts           domain normalization and validation
    ownership.ts        verification token and meta-tag check
    safe-fetch.ts       SSRF-hardened fetch for user-supplied sites
    manifest/           build, canonicalize, sign, validate manifests
agent-trust.schema.json manifest format (JSON Schema)
drizzle/                generated SQL migrations
```

## Roadmap

- [x] Accounts (email/password)
- [x] Domain claim + ownership verification via meta tag
- [x] Manifest generator: declare endpoints, validate against the schema, sign, serve at `/api/manifest/[domain]`
- [ ] Verification engine: endpoint/field match, prompt-injection scan, HTTPS, domain match, expiry
- [ ] Public verify endpoint, badge SVG, request log
- [ ] Scheduled re-verification

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

If you find a vulnerability, please don't open a public issue. Report it
privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

## License

[MIT](./LICENSE)
