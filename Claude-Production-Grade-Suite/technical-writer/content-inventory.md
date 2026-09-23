# Content Inventory — Technical Writer (T11)

## Inputs read (Phase 1 audit)

| Source | Files read | Relevance |
|---|---|---|
| `docs/architecture/` | 7 ADRs, tech-stack.md, design-principles.md, deployment-notes.md, production-deployment.md, 5 system-diagrams | high — existing, authoritative, linked not duplicated |
| `api/openapi/*.yaml` | 9 files (8 domains + `_common.yaml`) | high — full read, source of API reference |
| `schemas/` | erd.md, migrations 0001–0010 (0010 read in full) | high — source of data model docs |
| `services/app/src/modules/*` | 6 `index.ts` (module boundaries), `stock/index.ts` full, route handler example (`fefo-suggestion/route.ts`), `catalog/categories.ts` | high — source of withTenant()/RBAC code examples |
| `libs/shared/src/*` | `db/client.ts`, `rbac/index.ts`, `errors/index.ts`, `plan-limits/index.ts`, `storage/index.ts`, `payments/provider.ts` | high — source of error taxonomy, RLS pattern, storage/payment abstraction accuracy check |
| `docs/runbooks/*` | 7 files, titles + severity line only (not duplicated) | high — indexed in operations guide |
| `Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml` | full | high — SLO summary table in operations guide |
| `Claude-Production-Grade-Suite/.orchestrator/tasks.md` | tail (BUILD/HARDEN/SHIP narrative) | medium — used for README status update, not a standalone narrative doc |
| `README.md`, `Makefile`, `package.json`, `.env.example`, `docker-compose*.yml`, `tests/integration/docker-compose.test.yml`, `tests/integration/setup.ts`, `.github/workflows/{ci,test}.yml`, `services/app/eslint.config.js` | full | high — dev guide / contributing guide commands verified against real scripts |

## Gap analysis (against required doc matrix)

| Document | Status before this task | Status after |
|---|---|---|
| API reference (by domain) | missing (only raw OpenAPI existed) | done — `docs/api/` (9 files, 53 endpoints) |
| Developer guide (setup, structure, RLS pattern, module boundaries) | missing | done — `docs/guides/developer-guide.md` |
| Contributing guide | missing | done — `docs/guides/contributing.md` |
| Operational guide (index to deployment/backup/secrets/SLO/runbooks) | missing (only source docs existed, no summary/index) | done — `docs/operations/README.md` |
| Architecture overview (newcomer summary of ADRs/diagrams) | missing (only raw ADRs/diagrams existed) | done — `docs/architecture/overview.md` |
| README accuracy | stale ("Status: scaffold, fase DEFINE") | fixed — reflects Gate 3 / production-ready state, links new docs |

## Deliberately NOT duplicated

- ADR bodies, system diagrams, design-principles.md, deployment-notes.md, production-deployment.md — linked, not copied.
- `docs/runbooks/*` bodies — indexed with one-line severity/purpose only.
- SRE SLO file — summarized as a table with the operative numbers, full rationale left in source.

## Accuracy corrections made during writing (verified against code, not assumed)

1. **`FileStorage`/S3**: ADR-005 and `c4-container.md` describe S3-compatible storage as the
   intended production target. Verified in code (`libs/shared/src/storage/index.ts`) that only
   `LocalFileStorage` exists. Flagged explicitly in `docs/api/stock.md` and
   `docs/architecture/overview.md` as "not built" rather than documented as a capability.
2. **Module-boundary lint enforcement**: ADR-001 states the module import boundary is
   "reforçada por lint". Checked `services/app/eslint.config.js` — only
   `eslint-config-next` (core-web-vitals + typescript) is configured; no
   `no-restricted-imports`/`eslint-plugin-boundaries` rule exists. Documented as
   convention-and-review-enforced today, not lint-enforced, in both the developer guide and
   contributing guide.
