# Writing Notes — Technical Writer (T11)

## Locale / style decisions

- Settings (`Claude-Production-Grade-Suite/.orchestrator/settings.md`) mandate pt-BR for
  product/docs. Confirmed the existing convention by reading `api/openapi/*.yaml` (summaries and
  descriptions already pt-BR, field names camelCase English) and `docs/architecture/*` (fully
  pt-BR prose). All new docs (API reference, developer guide, contributing guide, operations
  guide, architecture overview) written in pt-BR prose, matching the existing corpus exactly —
  JSON field/schema names kept as-is (English camelCase, matching the OpenAPI specs and Prisma
  schema — never translated, since that would desync docs from the actual contract).
- Code comments quoted verbatim from source keep their original language (mostly pt-BR already in
  this codebase).

## Structural decisions

- `docs/api/` — one file per OpenAPI domain (matches `api/openapi/*.yaml` 1:1) plus a `README.md`
  covering cross-cutting concerns (auth cookies, RBAC matrix, pagination, error format) that would
  otherwise be repeated 8 times.
- `docs/guides/developer-guide.md` + `docs/guides/contributing.md` kept separate: the developer
  guide is "how to run/build things here" (reference material), contributing is "the rules for a
  PR" (process/checklist). They cross-link instead of merging, since a returning contributor
  mostly needs only the second one.
- `docs/operations/README.md` is deliberately an index/summary, never forking
  `production-deployment.md` or the 7 runbooks — every operational fact with a canonical source
  gets one line + a link, not a re-explanation.
- `docs/architecture/overview.md` added alongside (not replacing) `docs/architecture/*` — per
  task constraints, existing architecture files were not moved or restructured.

## Known documentation gaps flagged (not fabricated as solved)

- No API versioning strategy exists (`docs/api/README.md`, "O que esta referência não cobre").
- No outbound webhooks / AsyncAPI spec exists — only the inbound PagBank webhook.
- Rate limiting exists only on 3 auth endpoints, not as a general API policy.
- `/api/metrics` (Prometheus) does not exist yet — documented as an extension point in the
  operations guide, matching `production-deployment.md § 6`.
- Module-boundary rule (ADR-001) is not lint-enforced today — see content-inventory.md for the
  verification.

## Verification performed

- Every endpoint documented was cross-checked against the actual OpenAPI YAML (method, path,
  request/response shape, status codes) — no endpoint invented or renamed.
- Every code snippet in the developer/contributing guides is copied from real source files
  (`libs/shared/src/db/client.ts`, `libs/shared/src/rbac/index.ts`,
  `services/app/src/modules/stock/index.ts`, `services/app/src/modules/catalog/categories.ts`,
  `services/app/src/app/api/stock/fefo-suggestion/route.ts`) — not paraphrased from memory.
- Every `make`/`npm run` command referenced was checked against `Makefile` and `package.json`
  `scripts` — no invented command.
- Every runbook link resolves to a file confirmed present in `docs/runbooks/` (7 files, all
  listed, none invented, none skipped).
