# Test Plan — estoque-saas

**Author:** QA Engineer (Wave A, parallel with Backend/Frontend engineers — T5a)
**Status:** Draft acceptance oracle for BUILD. `tests/` is the QA-owned oracle of record
(loop-protocol Rule 4) — engineers implement against it; they may not edit, skip, or weaken it.
**Inputs read:** `Claude-Production-Grade-Suite/product-manager/BRD/brd.md`, all 8
`api/openapi/*.yaml` specs, ADR-001 through ADR-007, `docs/architecture/design-principles.md`,
`schemas/migrations/0001_init.sql`, `libs/shared/prisma/schema.prisma`,
`libs/shared/src/{db,audit,payments}`, `services/app/{package.json,tsconfig.json}`.

---

## Scope

**In scope:** every endpoint across the 8 OpenAPI domain specs (auth, tenants, catalog, stock,
sales, dashboard, billing, admin); every explicit BRD acceptance criterion; the four
cross-cutting guarantees called out by the orchestrator brief — multi-tenant RLS isolation,
NF-e import's no-mutation-before-confirm rule, FEFO suggestion + override logging, plan-limit
real-time enforcement, RBAC, the signup→login→dashboard journey, and payment webhook idempotency.

**Explicitly out of scope (per BRD "Out of Scope" / MVP boundaries):** NF-e/NFC-e *emission*
(sales-side fiscal documents — the system only *imports* supplier NF-e XML), native mobile app,
PDV hardware integration, e-commerce/marketplace channel integration, multi-currency, split
payment across multiple CNPJs in one tenant, and native Pix/boleto recurrence (mitigated via the
one-off monthly charge flow per ADR-004).

**Not yet testable at Wave A time (documented, not silently skipped):** `services/app/src/modules/
{auth,catalog,stock,sales,billing,admin}/index.ts` are all still `export {}` stubs, and
`libs/shared/prisma/schema.prisma` intentionally models only `Plan`/`PlatformAdmin`/`Tenant`/
`User`/`Store`/`Subscription`/`Invoice`/`Supplier`/`Category`/`Product`/`ProductStoreSetting`/
`Batch`/`Customer`/`StockAlertsConfig`/`AuditLog` (the stock-movement/sales/nfe-import/transfer/
notification models are deferred to BUILD per the schema's own comment). Every test below is
written against the **contracts** (OpenAPI shapes, `schemas/migrations/0001_init.sql`, the ADRs)
— not against code that exists yet — and is expected to fail or error until BUILD lands. See
"Phase 8 — Execution Results" for the actual, currently-observed failure reasons.

---

## Test Strategy

Standard pyramid, weighted toward integration because the highest-risk behavior in this system
(RLS isolation, NF-e confirm-gating, webhook idempotency, plan limits) lives at the
database/HTTP boundary, not in isolated pure functions:

| Layer | Weight | Rationale |
|---|---|---|
| Unit | Light | Only genuinely pure, HTTP-independent logic — the FEFO suggestion algorithm (ADR-006 explicitly calls this out as "função pura e testável") is the flagship example. Most of this domain's logic is inseparable from Postgres/RLS. |
| Integration | Heavy | RLS is a database-enforced guarantee — it can only be meaningfully tested against a real Postgres with the real `schemas/migrations/0001_init.sql` policies applied, per ADR-002. Same for NF-e's async-job + confirm-gate flow, webhook idempotency (DB unique constraint), and plan limits (real-time COUNT queries). All integration tests in this suite hit the real HTTP contract of the real running app (no route-handler mocking, no Auth.js mocking) — see `tests/fixtures/http-test-client.ts`. |
| Contract | Light | OpenAPI shapes are enforced implicitly by every integration test's response-body assertions (`toMatchObject`/`toEqual` against the documented schema). A dedicated schema-validation pass is a HARDEN-phase addition once responses are real (tracked in Risk Register). |
| E2E (Playwright) | Medium | Reserved for genuine cross-boundary journeys per boundary-safety Pattern 5 — full browser flows through real cookies/redirects, not endpoint-by-endpoint checks that are already covered by integration tests. |
| Performance (k6) | Light at Wave A | Scripts + thresholds are authored now so HARDEN-phase load testing has an oracle from day one; no baseline numbers exist yet (nothing to measure — see `tests/performance/baselines/*.json`). |

---

## Traceability Matrix — BRD Acceptance Criteria

| AC ID | BRD acceptance criterion (paraphrased) | Priority | Test type(s) | Test file(s) |
|---|---|---|---|---|
| AC-001 | NF-e XML upload lists items, flags unmatched, stock is written ONLY after explicit confirm | **P0** | Integration | `tests/integration/nfe-import.test.ts` |
| AC-002 | Product below min stock appears in low-stock alerts within 1 min of the triggering movement | P1 | Integration (timing-sensitive — see Risk Register) | *scaffold pending — see Gaps below* |
| AC-003 | Perishable product exit w/o batch → FEFO suggestion; manual override allowed and logged | **P0** | Unit (algorithm) + Integration (persistence/logging) | `tests/unit/stock/fefo.test.ts`, `tests/integration/sales-fefo-override.test.ts` |
| AC-004 | Batch within N days (30/15/7, configurable) of expiry appears in expiry alerts | P1 | Integration | *scaffold pending — see Gaps below* |
| AC-005 | `vendedor` role denied (403, no data exposure) on company settings / user management | **P0** | Integration | `tests/integration/rbac.test.ts` |
| AC-006 | Every stock movement generates an immutable audit record (who/what/when/before/after) | **P0** | Integration | `tests/integration/audit-log.test.ts` |
| AC-007 | Plan limit (products/users/stores) blocks creation over limit, real-time not batch | **P0** | Integration | `tests/integration/plan-limits.test.ts` |
| AC-008 | Card payment declined → subscription `past_due`, admin notified, grace period before restriction | **P0** (idempotency/status transition) / P2 (notification delivery) | Integration | `tests/integration/webhook-idempotency.test.ts` (status transition only; notification delivery not yet testable — no notification-sending contract in `billing.yaml`) |
| AC-009 | Pix/boleto: system auto-generates next-cycle charge N days ahead, reconciles via webhook | P1 | Integration | *scaffold pending — depends on a BullMQ repeatable-job contract not yet exposed via HTTP; see Gaps below* |
| AC-010 | Two tenants — no query ever returns another tenant's records; DB-level RLS | **P0 (CRITICAL, cross-cutting)** | Integration | `tests/integration/multi-tenant-isolation.test.ts`, `tests/integration/rls-schema-sweep.test.ts` |

**Business Rules coverage** (not separately numbered in the BRD, folded into the matrix above where
they extend an AC): RBAC full role matrix (admin/operador/vendedor) → `rbac.test.ts`; plan limits
checked per-tenant not globally → `plan-limits.test.ts` (last case); webhook idempotency via
`gateway_event_id` → `webhook-idempotency.test.ts`; cross-tenant resource access returns 404 never
403 (`_common.yaml` NotFound contract) → `rbac.test.ts` (last case).

---

## Traceability Matrix — OpenAPI Endpoint Coverage

| Spec | Endpoint | Test type | Priority | Covered by |
|---|---|---|---|---|
| auth | POST /api/auth/signup | Integration, E2E | P0 | `http-test-client.ts::signUpAndLogin` (used by nearly every suite), `signup-login-dashboard.spec.ts` |
| auth | POST /api/auth/login | Integration, E2E | P0 | same as above |
| auth | POST /api/auth/logout | E2E | P1 | `signup-login-dashboard.spec.ts` (logout step) |
| auth | POST /api/users/invite | Integration | P0 | `plan-limits.test.ts` (maxUsers case) |
| tenants | GET/PATCH /api/tenant | Integration | P0 | `rbac.test.ts` |
| tenants | GET/POST /api/stores | Integration | P0 | `plan-limits.test.ts`, most other suites (setup) |
| tenants | PATCH /api/stores/{id} | Integration | P1 | `rbac.test.ts` (cross-tenant 404 case) |
| tenants | GET /api/users, PATCH /api/users/{id}/role | Integration | P0 | `rbac.test.ts` |
| catalog | GET/POST /api/products | Integration | P0 | `plan-limits.test.ts`, `rbac.test.ts`, most suites |
| catalog | POST /api/products/import (CSV) | — | P2 | **Gap — no scaffold yet**, see below |
| catalog | GET/PATCH/DELETE /api/products/{id} | — | P2 | **Gap — no scaffold yet** |
| catalog | PUT /api/products/{id}/store-settings/{storeId} | — | P3 | Not scaffolded (low risk, simple override write) |
| catalog | GET/POST /api/categories, /api/suppliers | — | P3 | Not scaffolded (low risk CRUD) |
| stock | GET /api/stock/movements | — | P1 | Implicitly exercised as an assertion target in `audit-log.test.ts` via direct DB query; no dedicated HTTP-level pagination test yet — **gap** |
| stock | POST /api/stock/entries | Integration | P0 | `audit-log.test.ts`, `sales-fefo-override.test.ts` |
| stock | POST /api/stock/exits | Integration | P0 | `audit-log.test.ts` (reason-required case) |
| stock | GET /api/stock/fefo-suggestion | Integration | P0 | `sales-fefo-override.test.ts` |
| stock | POST /api/transfers | — | P1 | **Gap — no scaffold yet**, see below |
| stock | POST /api/nfe-imports, GET /api/nfe-imports/{id}, POST .../confirm | Integration, E2E | **P0** | `nfe-import.test.ts`, `nfe-import-journey.spec.ts` |
| stock | GET /api/alerts/low-stock, /api/alerts/expiring-batches | — | P1 | **Gap — no scaffold yet** (AC-002/AC-004) |
| sales | GET/POST /api/sales | Integration | P0 | `sales-fefo-override.test.ts`; insufficient-stock 409 case — **gap, not yet scaffolded** |
| sales | GET /api/sales/{id} | — | P2 | Not scaffolded |
| sales | GET/POST /api/customers, GET .../history | — | P2 | Not scaffolded (low complexity CRUD + read) |
| dashboard | all 4 endpoints (abc-curve, turnover, stalled-products, best-sellers) | Performance only | P2 | `dashboard-abc-curve.k6.js`; correctness assertions not yet scaffolded — **gap**, calculation logic is nontrivial enough to deserve unit tests once the aggregation functions exist |
| billing | GET /api/plans, GET/POST /api/billing/subscription | Integration | P0 | `webhook-idempotency.test.ts`, `rbac.test.ts` |
| billing | PATCH /api/billing/subscription/plan | — | P1 | **Gap** — downgrade-below-current-usage 409 case not yet scaffolded |
| billing | GET /api/billing/invoices | — | P2 | Not scaffolded |
| billing | POST /api/webhooks/pagbank | Integration | **P0** | `webhook-idempotency.test.ts` |
| admin | POST /api/platform-admin/login | — | P1 | **Gap** — separate session system (platform_admins, RLS-exempt) not yet scaffolded; recommend a dedicated `tests/integration/platform-admin.test.ts` in the next QA pass confirming platform sessions and tenant sessions are fully isolated (zero-trust interno per design-principles.md) |
| admin | GET /api/platform-admin/tenants, POST .../suspend, .../reactivate | — | P1 | **Gap**, same as above |
| admin | GET /api/platform-admin/metrics | — | P3 | Not scaffolded |

**Coverage summary:** 10/10 BRD acceptance criteria have an assigned priority and test type; 5/10
have an executable scaffold today (the ones marked P0-CRITICAL or explicitly named in the Wave A
brief). The remaining P1/P2 items are enumerated above as named gaps rather than silently
omitted, per the input-validation protocol's "degraded, not silent" rule — recommended as the
QA backlog for the T5b (Wave B, "QA Engineer — implement tests") pass once real code exists to
test against.

---

## Environment Requirements

| Dependency | Used by | How to provide it |
|---|---|---|
| PostgreSQL 18 (`schemas/migrations/0001_init.sql` applied) | All integration tests | `docker compose -f tests/integration/docker-compose.test.yml up -d` → `TEST_DATABASE_URL=postgresql://estoque_app:devpassword@localhost:5433/estoque_saas_test`. Tests call `resetTestDatabase()` per-file (drops/recreates `public` schema, re-applies the migration SQL) — no shared/leaked state across files. |
| Redis 7 | BullMQ-backed flows (NF-e async parse) indirectly, via the running app | Same compose file, `TEST_REDIS_URL=redis://localhost:6380` |
| Running app (`services/app`, real HTTP) | All integration + e2e-api + e2e-ui tests | `npm run dev --workspace services/app -- -p 3100` pointed at the above DB/Redis, OR let `tests/e2e/playwright.config.ts`'s `webServer` boot it automatically. Integration tests (`tests/vitest.config.ts`) assume `TEST_BASE_URL` (default `http://localhost:3100`) is already serving — they do NOT boot the app themselves (kept fast/composable; CI wires this in `.github/workflows/test.yml`). |
| `DATABASE_URL` env for the app process itself | readyz, all Prisma-backed routes | Must point at the SAME Postgres as `TEST_DATABASE_URL` for integration tests to observe consistent state. |
| Chromium (Playwright) | e2e-ui specs | `npx playwright install chromium` — verified working in this environment (see Phase 8). |
| `bcryptjs` (test-only devDependency, root `package.json`) | `tests/fixtures/db-test-helpers.ts::seedUser` | Already installed; see Risk Register for the assumption this encodes. |

---

## Coverage Targets

See `tests/coverage/thresholds.json` for the machine-readable version. Summary: 80% lines/
statements, 75% branches, 80% functions globally; `stock` and `billing` modules held to 90%
(highest-risk domain logic — NF-e/FEFO and payment webhooks/plan-limits respectively) per
qa-engineer skill guidance to weight thresholds by risk, not apply a flat 100% (which the skill's
own "Common Mistakes" table calls out as counter-productive).

---

## Risk Register

| # | Risk / gap | Severity | Notes |
|---|---|---|---|
| 1 | **`api/openapi/auth.yaml` has no "accept invite / set password" endpoint.** `POST /api/users/invite` creates a `status=invited` user, but there's no public contract for that user to set a password and become `active`. | **High** — blocks a real E2E test of the full invite→accept→login journey for operador/vendedor roles (BRD Epic 1: "convidar usuários... para controlar quem faz o quê"). | Workaround used in `rbac.test.ts`: seed the user directly via SQL with a bcrypt hash (`tests/fixtures/db-test-helpers.ts::seedUser`). Recommend Solution Architect add this endpoint before BUILD locks the auth contract. |
| 2 | **`schemas/migrations/0001_init.sql` does not actually create a restricted `app_user`/`estoque_app` role separate from the migration-admin connection** — the `REVOKE UPDATE, DELETE ON audit_log FROM app_user` line is commented out with a TODO ("Ajustar GRANTs conforme o usuário de aplicação criado no ambiente"). | **High** — ADR-007's core guarantee ("imutabilidade garantida pelo Postgres, não apenas por convenção de código") is currently unenforced at the DB level. | `tests/integration/rls-schema-sweep.test.ts` and `tests/integration/audit-log.test.ts` both assert this and are EXPECTED to catch it once a real least-privilege role exists — until then they will legitimately fail. DevOps/Backend must provision the role and uncomment/adapt the REVOKE. |
| 3 | No explicit latency/throughput NFRs found in `docs/architecture/` (design-principles.md only says "sem requisito de tempo real forte"). | Medium | `tests/performance/thresholds.js` values are QA-proposed defaults, flagged for SRE/Architect confirmation during HARDEN. |
| 4 | AC-002 (low-stock alert within 1 minute) and AC-004 (expiry alert window) both depend on a BullMQ repeatable job (per ADR-006 §4) with no synchronous HTTP trigger — testing the actual "within 1 minute" timing claim requires either a fast-forwarded job clock or a test-only manual-trigger endpoint. | Medium | Not scaffolded at Wave A; recommend the Backend Engineer expose a test-only `POST /api/_internal/alerts/run` (non-prod only) or that QA test the alert *query* logic directly rather than the job's wall-clock timing. |
| 5 | `_common.yaml` NotFound response doc states RLS must never leak 403-vs-404, but no endpoint explicitly documents this for every resource — only inferred. | Low | `rbac.test.ts` asserts it for `/api/stores/{id}`; recommend extending to every `{id}`-scoped endpoint once implemented. |
| 6 | Password hashing algorithm is assumed to be bcrypt (industry standard for an Auth.js Credentials provider) for the purpose of `seedUser()`'s direct-SQL test fixture. | Low | If the Backend Engineer chooses a different algorithm (e.g. argon2), only `tests/fixtures/db-test-helpers.ts` needs updating — no test assertions change. |
| 7 | This sandbox has no Docker/Postgres available, so integration and most e2e suites could not be run to completion here — see Phase 8 for exactly what WAS verified (unit test collection, strict TypeScript typecheck of the whole `tests/` tree, Playwright test listing, and 2 of 3 real HTTP smoke tests against a genuinely running `next dev` server). | Informational | Recorded as **UNVERIFIED**, not silently assumed passing, per loop-protocol Rule 1. Whoever runs BUILD/HARDEN in an environment with Docker must execute `npm run test:qa:integration:up && npm run test:qa` for the first real signal. |

---

## Phase 8 — Execution Results

Environment: this sandbox has Node 24 / npm 11, full npm registry access (verified — `npm install`
succeeded), but **no Docker and no local PostgreSQL**. This bounds what could be executed to
completion; every claim below states exactly what ran and what its real output was.

### What ran, and what it proved

1. **`npx tsc --noEmit -p tests/tsconfig.json`** (strict mode, matching `tsconfig.base.json`,
   `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` included) — clean except for the one
   genuinely-expected error: `tests/unit/stock/fefo.test.ts(14,36): Cannot find module
   '@/modules/stock/fefo'`. Every fixture, helper, integration test, and e2e spec in the tree
   type-checks. (Several real bugs were caught and fixed during this pass: a wrong relative
   import path in `nfe-import-journey.spec.ts`, `exactOptionalPropertyTypes` violations in
   `http-test-client.ts` and `vitest.config.ts`, and an implicit-`any` callback parameter.)

2. **`npx vitest run --config tests/vitest.config.ts`** — 9 test files collected (1 unit + 8
   integration), 0 crashed on syntax/import resolution for their own code. Results:
   - `tests/unit/stock/fefo.test.ts`: fails to collect — `Cannot find module
     '@/modules/stock/fefo'`. **This is the correct RED state** — the module does not exist yet;
     this is the file the Backend Engineer implements against.
   - All 8 `tests/integration/*.test.ts`: fail in `beforeAll` with `ECONNREFUSED
     127.0.0.1:5433` / `::1:5433` — no Postgres reachable in this sandbox. **UNVERIFIED**, not
     failing, not passing — genuinely could not run. `npm run prisma:generate` was run
     successfully first (confirms the Prisma schema itself is valid and the generated client
     loads).

3. **`npx playwright test --config tests/e2e/playwright.config.ts --list`** — all 8 e2e tests
   across 3 spec files listed correctly (initial run caught and fixed a real bug: the root
   `package.json` has no `"type": "module"`, so Playwright's Node loader tried to `require()` the
   ESM config; fixed by adding `tests/package.json` with `"type": "module"`, scoped to the
   `tests/` tree only).

4. **`npx playwright test tests/e2e/api/smoke.e2e.ts`** (installed Chromium first) — this
   **actually booted the real Next.js app** via the `webServer` config (`next dev -p 3100`) against
   this sandbox's (unreachable) test DB env vars, and ran real HTTP requests against it:
   - `GET /api/healthz` → **200, passed for real** (genuine live-server round trip, not a mock).
   - `GET /` → **200, passed for real**.
   - `GET /api/readyz` → **failed as expected**: got `503` (route correctly reports `not_ready`
     when its `SELECT 1` Prisma probe can't reach a database — this is the *correct*, intended
     behavior being exercised, not a bug).

5. **`npx playwright test tests/e2e/ui/flows/signup-login-dashboard.spec.ts -g "unauthenticated visitor"`**
   — ran against the same live server. Failed exactly as expected: `/dashboard` has no page and no
   auth guard implemented yet (`services/app/src/app/page.tsx` is the only page beyond the API
   route stubs), so the browser stayed on `/dashboard` instead of redirecting to `/login`. **This
   is precisely the RED state Pattern 2/5 requires the Frontend Engineer to turn green**: implement
   the `proxy.ts` auth guard (per ADR-003's Next.js 16 naming note) that redirects unauthenticated
   visitors away from `/dashboard`.

### Bugs found and fixed during this verification pass (in the test code itself, not app code)

- Wrong relative import depth in `tests/e2e/ui/flows/nfe-import-journey.spec.ts`.
- Missing `tests/package.json` (`"type": "module"`) — Playwright couldn't load an ESM config
  without it.
- `exactOptionalPropertyTypes` strictness violations in `tests/fixtures/http-test-client.ts` and
  `tests/vitest.config.ts`.
- `tests/fixtures/db-test-helpers.ts::seedUser` originally returned an empty `id` string instead
  of the DB-generated UUID (would have broken every test relying on the returned user id, e.g.
  `audit-log.test.ts`'s `user_id` assertion) — fixed to `RETURNING id`.
- `afterAll` hooks in DB-backed integration suites now null-guard the client (`await db?.end()`)
  so a `beforeAll` connection failure reports one clean error instead of a cascading
  `TypeError: Cannot read properties of undefined`.

### Test-integrity check

No prior version of `tests/` existed before this Wave A pass (fresh repo), so there is nothing to
diff against for weakening. This test-plan.md and every file in `tests/` constitute the baseline
going forward — any future diff against this baseline that loosens an assertion, skips a case, or
lowers a threshold without QA sign-off is a Critical finding per loop-protocol Rule 4.
