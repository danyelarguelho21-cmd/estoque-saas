# Coverage & Execution Report — estoque-saas (Wave B, real Docker stack)

Full narrative in `test-plan.md` §"Wave B — Real Execution Summary" (test-bug ledger,
test-integrity review). This file is the compact, receipt-friendly execution summary — every
number below is from an ACTUAL run in this session, not a file count or an estimate.

## Environment

`docker compose up -d` — `postgres:18-alpine` (healthy, 127.0.0.1:5432), `redis:7-alpine` (healthy,
127.0.0.1:6379), `app` (healthy, http://localhost:3000), `worker` (healthy). Migrations applied
(`prisma migrate dev` + `scripts/apply-role-grants.mjs` — `app_user`/`platform_admin_role` roles,
RLS enabled on all 21 tenant-scoped tables). `scripts/seed-plans.mjs` run. Two manually-created
tenants pre-existed from prior manual QA; this pass's automated tests create their own fresh
tenants throughout (unique CNPJ/email per test) and do not depend on or disturb them.

## Test execution counts (real, from actual runs against the live stack)

| Suite | Files | Tests | Passing | Failing | Notes |
|---|---|---|---|---|---|
| Unit (`tests/unit`) | 1 | 7 | **7** | 0 | `npm run test:qa:unit` |
| Integration (`tests/integration`) | 11 (9 Wave A + 2 new Wave B) | 48 | **43** | 5 | `npm run test:qa:integration` against real Postgres, real running app (`localhost:3000`) |
| E2E — Playwright, real Chromium (`tests/e2e`) | 5 (3 api/ui + 2 ui flows) | 8 | **7** | 1 | `npx playwright test --config tests/e2e/playwright.config.ts`, reusing the already-running app |
| Performance (k6) | 3 scripts | — | — | — | Not run — no `k6` binary in this environment (findings/low.md L-2) |
| **Total (vitest, unit+integration)** | 12 | 55 | **50 (90.9%)** | 5 | — |
| **Total incl. e2e** | 17 | 63 | **57 (90.5%)** | 6 | — |

## The 6 real failures, all attributable to 2 distinct, genuine application bugs (not test defects)

| Test | Failure mode | Root cause |
|---|---|---|
| `nfe-import.test.ts` × 4 | `500`/`undefined` on upload and everything downstream | **C-1** (`findings/critical.md`) — `EACCES` writing to `./.data/uploads`, non-root Docker user, no writable volume |
| `nfe-import-journey.spec.ts` × 1 (e2e) | Upload never reaches the review screen | Same **C-1**, reproduced through the real browser |
| `rbac.test.ts` "cross-tenant access is a 404, never a 403" | `500` instead of `404` | **H-1** (`findings/high.md`) — unhandled Prisma `P2025` from `findUniqueOrThrow`, systemic across ≥6 call sites |

Both bugs were root-caused independently of the failing test (via `docker compose logs app` +
standalone curl/Node-fetch reproduction) before being filed — the test failures are the correct,
intended RED signal, not defects to paper over.

## Code coverage

Not run this pass — `npx vitest run --coverage` was not invoked (the priority this pass was
getting the full suite executing for real against live infrastructure, plus closing the two named
P1 gaps; `tests/coverage/thresholds.json` targets remain the reference for a future coverage pass).

## Wave B new test files (closing test-plan.md risk-register gaps)

- `tests/integration/transfers.test.ts` — **6/6 passing**. `POST /api/transfers`: valid transfer
  (exact debit/credit), insufficient-stock 409 with zero side effects, a dedicated
  **multi-item atomicity** case (item 1 individually-valid + item 2 insufficient-stock rolls back
  BOTH, not just item 2 — the specific bug class a per-item test would miss), same-store rejection,
  empty-items rejection, and a perishable-product batch move (origin batch decremented, matching
  batch created/credited at destination with the same batch identity).
- `tests/integration/plan-downgrade.test.ts` — **5/5 passing**. `PATCH
  /api/billing/subscription/plan`: downgrade blocked (409, violations named) when over the target
  plan's limits, downgrade allowed at exactly the limit, downgrade allowed + persisted to BOTH
  `tenants.plan_id` and `subscriptions.plan_id` when under, upgrade always allowed regardless of
  usage, and RBAC (operador denied, 403).

## Test-bug fixes this pass

See `test-plan.md` §"Wave B — Real Execution Summary" for the full 8-item ledger (UUID defaults,
non-destructive `resetTestDatabase()`, `appUserClient()` for real privilege checks, role-name
constant fix, the cookie-jar bug in `http-test-client.ts` that was causing ~20 false-401 failures,
RBAC test-pollution from hardcoded emails, a full webhook fixture rewrite against the real PagBank
contract, and a full e2e page-object/route rewrite against the real frontend).

## Test-integrity review

Diffed `tests/` against every prior commit that touched it. Only the Wave A merge-back commit
(`95f8d0c`) touched `tests/` before this pass, and its one change is purely additive (an alias
field on a fixture type) — no weakening. **No Critical test-integrity finding.**

## Recommended next step

1. Route C-1 and H-1 to the software-engineer/remediation track (findings/critical.md,
   findings/high.md have full repro + suggested fixes).
2. Re-run `tests/integration/nfe-import.test.ts` + `tests/e2e/ui/flows/nfe-import-journey.spec.ts`
   after C-1 is fixed — expected to go fully green with zero test changes needed.
3. Re-run `tests/integration/rbac.test.ts` after H-1 is fixed (or after H-1's other 5 call sites
   are patched, run a fuller not-found sweep).
4. Run the k6 suite once a `k6` binary is available in this environment.
