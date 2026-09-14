# Contributing to TrustTab

Thanks for your interest! TrustTab is early, so the most valuable
contributions right now are bug reports, security review, and feedback on the
manifest format.

## Ground rules

- **Open an issue before large changes.** Especially anything touching the
  manifest schema or the verification checks. Those are part of the protocol,
  not just this codebase.
- **The `purpose` enum is centrally maintained.** New values (e.g. a new form
  category) are added in the schema file with a short justification, never
  ad hoc in the UI.
- **Never fetch user-supplied URLs directly.** Use `safeFetchText` in
  `src/lib/safe-fetch.ts`, which blocks private-network addresses and
  cross-site redirects.
- **No secrets in code**, including tests and examples. Use environment
  variables and document new ones in `.env.example`.

## Development

See "Self-hosting / local development" in the [README](./README.md). Before
opening a pull request, run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

If you change `src/db/schema.ts`, run `npm run db:generate` and commit the
generated migration in `drizzle/` together with the schema change.

## Commit messages

Write them for someone reading the history a year from now: a short imperative
summary line ("Add domain ownership check"), then a body explaining *why* when
the change isn't obvious.

## Security issues

Please report vulnerabilities privately (see the Security section of the
README) rather than in a public issue.
