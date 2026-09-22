# Coverage & Execution Report — estoque-saas (Wave A)

Full narrative in `test-plan.md` §"Phase 8 — Execution Results". This file is the compact,
receipt-friendly summary.

## Code coverage

Not measurable yet — `services/app/src/modules/**` are all `export {}` stubs and
`libs/shared/prisma/schema.prisma` models only half the domain (see test-plan.md "Scope" /
"Not yet testable at Wave A time"). `tests/coverage/thresholds.json` defines the targets (global
80/75/80/80 lines/branches/functions/statements; `stock` and `billing` at 90%) that CI will
enforce once BUILD lands real implementation for `npx vitest run --coverage` to measure against.

## Test execution counts (real, from actual runs in this sandbox — not file counts)

| Suite | Files | Tests collected | Result |
|---|---|---|---|
| Unit (`tests/unit`) | 1 | 7 | 0 passing / 0 failing / **1 file failed to collect** (`Cannot find module '@/modules/stock/fefo'` — expected RED, oracle for Backend Engineer) |
| Integration (`tests/integration`) | 8 | 37 | 0 passing / 0 failing / **8 files failed in `beforeAll`** (`ECONNREFUSED` — no Postgres in this sandbox; **UNVERIFIED**, not a code defect) |
| E2E — API smoke (`tests/e2e/api/smoke.e2e.ts`) | 1 | 3 | **2 passing for real** (healthz, `/`) against a genuinely-booted `next dev` server; **1 failing as designed** (readyz → 503, correctly reports DB unreachable) |
| E2E — UI (`tests/e2e/ui`) | 2 | 5 (1 run) | 1 run, **failed as expected** (`/dashboard` has no auth guard yet — the exact gap Pattern 2/5 requires the Frontend Engineer to close) |
| Performance (`tests/performance`) | 3 k6 scripts | — | Not run (no k6 binary in this sandbox, no live load target); scripts + thresholds + baseline placeholders are in place for HARDEN-phase use |

**Totals this pass:** 9 vitest test files collected (1 unit + 8 integration, 44 individual test
cases), 3 Playwright spec files (8 test cases), 3 k6 scripts. TypeScript strict-mode typecheck of
the entire `tests/` tree is clean except the one intentional RED import.

## Why "failed" here is correct, not a problem

Every integration/unit failure traces to one of exactly two causes, both expected at Wave A:
1. **No implementation exists yet** (`Cannot find module '@/modules/stock/fefo'`, no `/dashboard`
   page, no auth guard) — this IS the point of writing scaffolds first; Backend/Frontend build
   until these turn green.
2. **No Docker/Postgres in this execution sandbox** (`ECONNREFUSED`) — an environment limitation,
   recorded as UNVERIFIED per loop-protocol Rule 1, not claimed as passing or as a code defect.

Two smoke tests and the typecheck pass are unconditionally real, positive signal: the test
infrastructure itself (config, fixtures, HTTP client, Playwright wiring) is correct and working
against the actual running application, not just syntactically plausible.

## Recommended next verification step (for whoever runs BUILD/HARDEN with Docker available)

```
npm run test:qa:integration:up   # starts tests/integration/docker-compose.test.yml
TEST_DATABASE_URL=postgresql://estoque_app:devpassword@localhost:5433/estoque_saas_test \
DATABASE_URL=postgresql://estoque_app:devpassword@localhost:5433/estoque_saas_test \
  npm run test:qa                # unit + integration
npm run test:qa:e2e              # boots the app itself via Playwright webServer
```
