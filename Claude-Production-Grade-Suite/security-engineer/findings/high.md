# High Findings — Wave B CODE-LEVEL Audit (estoque-saas)

Supersedes the Wave A version of this file (preserved in git history). SLA per severity standard:
fix within 1 week of being confirmed against real code.

---

## Wave A highs — verification result

| ID | Wave A finding | Wave B status |
|----|----------------|----------------|
| H-1 | Nothing structurally prevents `platformPrisma` misuse for tenant queries | **Verified NOT exploited today; downgraded to Low/informational.** Grepped every `platformPrisma`/`platformAdminPrisma` usage in `services/app/src` and `libs/shared/src` (16 call sites). Every one is justified: global tables (`plans`, `platform_admins`), the three narrow `SECURITY DEFINER` `$queryRaw` lookups (`auth_lookup_user_by_email`, `billing_lookup_tenant_by_gateway_ref`, `platform_list_active_tenant_ids`), the health-check `SELECT 1`, and `platformAdminPrisma` restricted to `modules/admin/*`. The three real bugs of this exact class from Wave A/B history (`getTenantWithPlan`, `catalog/products.ts`, `billing/subscriptions.ts`, `auth/invite.ts` — see `tasks.md` commit `333cf7e`) are confirmed fixed: `modules/auth/tenant.ts` now uses `withTenant()` with an explicit comment warning against regressing to `platformPrisma`, and `modules/auth/invite.ts:27-29` does the same. No new instance introduced. The structural risk (no compile-time marker distinguishing "platform-only" from "tenant" Prisma clients) still exists — see Medium `M-8` below for the recommended static-check follow-up. |
| H-2 | RBAC not machine-encoded in the API contract; self-escalation risk | **Mitigated in code, residual gap in the contract itself.** `PATCH /api/users/{userId}/role` (`services/app/src/app/api/users/[userId]/role/route.ts`) calls `requireRole("users:manage")`, and `libs/shared/src/rbac/index.ts` maps `users:manage` to `["admin"]` only — a `vendedor`/`operador` session gets a 403 before `updateUserRole()` ever runs, closing the concrete self-escalation attack modeled in Wave A. Spot-checked every mutating route under `services/app/src/app/api/**`: all 33 non-public route files call `requireSession()`/`requireRole()` as the first line inside `handleRoute()`. The contract itself (`api/openapi/*.yaml`) still only documents roles as prose, not a machine-checkable extension — recommend Code Reviewer/QA add `x-required-roles` as a follow-up, but this is no longer an open *vulnerability*, just a spec-completeness gap. |
| H-3 | NF-e/CSV upload had no size limit, parser guard, or per-tenant rate control | **Was open, FIXED this session.** See "Fixes applied" below. |
| H-4 | Auth.js v5 + Next.js 16 beta pairing — compounding risk factor | **Unchanged (informational, not independently fixable by this audit).** `services/app/package.json` still pins the beta channel (now `5.0.0-beta.32`, the latest published version and the one with the Critical CVE above patched — see `critical.md`). `.npmrc` still requires `legacy-peer-deps=true`. `proxy.ts` was read in full and correctly branches by pathname per boundary-safety Pattern 4 (three families: `/api/*`, `/admin/*`, tenant pages — never a blanket result). Recommend re-evaluating pinning to a stable `next-auth` release once v5 exits beta; track as a standing SRE/DevOps dependency-freshness item, not a HARDEN blocker. |
| H-5 | No rate limiting on `/api/auth/login`, `/api/auth/signup`, `/api/platform-admin/login` | **Was open, FIXED this session.** See "Fixes applied" below. |

---

## Fixes applied this session

### H-3 — Upload size limits (NF-e XML, product CSV)

**Root cause confirmed:** neither `POST /api/nfe-imports` (`services/app/src/app/api/nfe-imports/route.ts`)
nor `POST /api/products/import` (`services/app/src/app/api/products/import/route.ts`) had any
size check — both read the entire multipart file into a `Buffer` unconditionally before handing it
to `defaultFileStorage.save()` / enqueueing the parse job. `services/app/src/worker/index.ts`
confirmed the NF-e/CSV-import BullMQ queues run on the single shared worker process (ADR-001) —
one tenant's oversized upload can starve billing/alert jobs for every other tenant.

**Fix:** `libs/shared/src/storage/index.ts` now exports `MAX_NFE_UPLOAD_BYTES` (10 MiB),
`MAX_CSV_UPLOAD_BYTES` (20 MiB), and `assertUploadSizeWithinLimit(sizeBytes, maxBytes)` (throws
`ValidationError`, 400). Both route handlers call it against the `File`'s `.size` property
**before** calling `.arrayBuffer()` — the check itself never materializes the oversized payload
in memory, so it isn't itself an amplification vector. `processNfeImportJob`/parser-level
depth/entity guards were already closed by C-5 (`processEntities: false`); a worker-level
per-job timeout and per-tenant queue concurrency limit (Wave A's control #3) remain unimplemented
and are BullMQ/queue-configuration concerns — recommended as a DevOps/SRE follow-up (queue
`limiter`/`concurrency` options on the `Worker` constructor in `services/app/src/worker/index.ts`),
tracked as Medium `M-9` below since the size cap alone already closes the most severe (unbounded)
version of the DoS.

**Regression test:** `libs/shared/src/storage/index.test.ts` (new, 6 cases) — allows at/under the
limit, rejects one byte over, rejects a simulated 500MB payload, confirms the thrown error is a
`ValidationError` with a safe user-facing message (never a raw size/stack leak). Passing.

**Wave B verification performed:** unit-level only (`assertUploadSizeWithinLimit` in isolation) —
confirmed via `npx vitest run` (6/6 passing) and the full oracle (typecheck+lint green) and full
`npm run build` (all 46 routes compile). **Verify against the running stack:** POST a >10MB file to
`/api/nfe-imports` and a >20MB file to `/api/products/import` with a valid session and confirm a
400 `VALIDATION_ERROR` response before the file reaches disk/the queue (check `.data/uploads/` or
the configured storage backend is not written to).

### H-5 — Rate limiting on auth endpoints

**Root cause confirmed:** repo-wide grep for rate-limit/throttle terminology outside protocol docs
still returned zero results before this fix — `/api/auth/login`, `/api/auth/signup`, and
`/api/platform-admin/login` had no request-volume control of any kind.

**Fix:** new `services/app/src/lib/rate-limit.ts` — Redis-backed fixed-window counter (`INCR` +
`PEXPIRE ... NX`, using the same `REDIS_URL` already required for BullMQ, so no new
infrastructure dependency). `checkRateLimit()` fails **open** on a Redis error (a deliberate,
documented trade-off: an infra outage on a defense-in-depth control should not take down login
entirely, and the same Redis is already relied on for queues, so an outage is independently
alarmed). Wired into all three routes:
- `POST /api/auth/login` — per-IP (20/5min) *and* per-email (6/15min) buckets, both must pass.
- `POST /api/auth/signup` — per-IP (5/hour) — creates a full tenant per call, deliberately the
  strictest window since legitimate signup is a rare, deliberate action.
- `POST /api/platform-admin/login` — per-IP (10/5min) *and* per-email (4/15min), **strictly
  not weaker** than tenant login on either axis, per the Wave A requirement (highest blast-radius
  credential in the system).

All five limits are overridable via env var (`RATE_LIMIT_LOGIN_IP_MAX`, etc. — see
`.env.example`) with the values above as production-safe defaults; this exists specifically so
QA's integration suite (`tests/fixtures/http-test-client.ts`'s `signUpAndLogin()`, called by
effectively every integration test, always from the same test-runner IP) can be tuned via
environment configuration in its own Docker Compose file without touching QA-owned test code or
weakening the production defaults — **I did not edit anything under `tests/`,** per this task's
ownership boundary; flagging this as an action item for whoever owns
`tests/integration/docker-compose.test.yml` (DevOps/QA) to set the `RATE_LIMIT_*_MAX` env vars
generously for CI before that suite is next run against a live stack, since I could not run it
myself in this Docker-unavailable worktree to confirm empirically.

A new `RATE_LIMITED` error code / `RateLimitedError` class (429) was added to
`libs/shared/src/errors/index.ts`, following the existing `AppError` pattern exactly.

**Regression tests:** `services/app/src/lib/rate-limit.test.ts` (new, 9 cases) — allows up to the
limit, throws `RateLimitedError` once exceeded, independent buckets don't cross-contaminate,
fails open on a store error, `clientIp()` header parsing/fallback, and a policy-shape assertion
that admin-login limits are never weaker than tenant-login limits. `libs/shared/src/errors/index.test.ts`
gained one case asserting `RateLimitedError` → 429/`RATE_LIMITED`. All passing.

**Wave B verification performed:** unit-level (in-memory fake store, no real Redis) plus full
oracle + full `npm run test --workspaces` (75/75 passing) + `npm run build` (green) after wiring.
**Not verified against real Redis or over real HTTP** (Docker unavailable). **Verify against the
running stack:** issue 7 rapid `POST /api/auth/login` requests with the same wrong-password email
and confirm the 7th returns 429 with `code: "RATE_LIMITED"`; confirm `/api/platform-admin/login`
locks out at a lower count than `/api/auth/login` from the same IP.
