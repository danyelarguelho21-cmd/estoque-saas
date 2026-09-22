# Critical Findings — Wave B CODE-LEVEL Audit (estoque-saas)

**Status:** Wave B (HARDEN phase) — audited against the real, running implementation
(`services/app/src/**`, `libs/shared/src/**`, `schemas/migrations/*.sql`, `docker-compose.yml`,
`services/app/Dockerfile`), not the design-level architecture reviewed in Wave A. This file
**supersedes** `Claude-Production-Grade-Suite/security-engineer/findings/critical.md` as it stood
after Wave A — that content is preserved in git history (`threat-model.md` and the Wave A
commit `2f31bcd`) for reference. All items below were verified by reading the actual code/SQL
unless explicitly marked "verify against the running stack" (Docker unavailable in this worktree
— see receipt `verification` field).

---

## Wave A criticals — verification result

| ID | Wave A finding | Wave B status | Evidence |
|----|----------------|----------------|----------|
| C-1 | RLS inert — single superuser role used everywhere | **CLOSED** | `schemas/migrations/0003_app_role_and_grants.sql:30-35` creates `app_user` with `NOBYPASSRLS NOSUPERUSER`; `schemas/migrations/0008_enable_row_level_security.sql` enables RLS + `tenant_isolation` policy on all 21 tenant-scoped tables (20 `tenant_id`-keyed + `tenants` itself keyed on `id`, + `audit_log`); `docker-compose.yml:54,79` wires `APP_DATABASE_URL=postgresql://app_user:...` for both `app` and `worker` services (never the admin `DATABASE_URL`); `libs/shared/src/db/client.ts:16-31` reads only `APP_DATABASE_URL` for the runtime client and prints a loud warning (never a silent fallback that reaches production, since `APP_DATABASE_URL` is required in `docker-compose.yml`) if it's missing. |
| C-2 | `audit_log` immutability REVOKE commented out | **CLOSED** | `0003_app_role_and_grants.sql:66-67` — `GRANT SELECT, INSERT ON audit_log TO app_user; REVOKE UPDATE, DELETE ON audit_log FROM app_user;` is real, uncommented SQL, applied by `scripts/apply-role-grants.mjs` after every deploy (idempotent). |
| C-3 | `product_store_settings` had RLS policy but no `tenant_id` column | **CLOSED** | `libs/shared/prisma/schema.prisma` `ProductStoreSetting` model has `tenantId String @map("tenant_id") @db.Uuid` as a direct (non-subquery) column, included in the 0008 RLS loop. |
| C-4 | PagBank webhook signature verification unimplemented stub | **CLOSED** | `libs/shared/src/payments/providers/pagbank.ts:187-193` — real implementation: `sha256(secret-payload)` hex digest, `timingSafeEqual` with a length check performed *before* the constant-time compare (this is the correct pattern — `timingSafeEqual` throws on length mismatch, and the length of a fixed-format hex digest is not attacker-useful information; this is not a re-introduction of the timing side-channel the finding warned about). `services/app/src/app/api/webhooks/pagbank/route.ts` reads the body via `req.text()` (raw bytes, never `req.json()` first) and verification runs before any parsing/mutation in `modules/billing/webhook.ts:19-21`. `PagBankProvider`'s constructor fails fast if `apiKey`/`webhookSecret` is empty (`pagbank.ts:90-95`). Unit tests exist (`pagbank.test.ts`, 10 cases). |
| C-5 | `fast-xml-parser` not XXE-safe by default, no version floor | **CLOSED** | `services/app/src/modules/stock/nfe-parser.ts:27-39` constructs `XMLParser` with `processEntities: false` explicitly; `services/app/package.json:35` pins `fast-xml-parser: ^5.5.8` (above the 5.3.5 CVE-2026-25896 fix line researched in Wave A). |

**Residual for C-1 specifically:** the role-separation and RLS-enablement are correct *as SQL*,
but I could not connect to a live Postgres in this worktree (a second stack would port-collide
with the one already running from the main checkout, per task instructions) to run the two
Wave-A-specified verification queries. **Verify against the running stack:**
1. `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` connected as
   `app_user` — both must be `false`.
2. Attempt a tenant-table query without `withTenant()` (i.e. import `platformPrisma` directly
   against e.g. `products`) and confirm it returns zero rows, not another tenant's data.
`tasks.md` already records that `docker compose up --build` was run once for real in this repo's
history (commit `333cf7e`) and a second-tenant cross-read was empirically confirmed blocked after
the 0008 migration was added — this is corroborating evidence, not a substitute for re-running
the two queries above after any future schema change.

---

## NEW — CVE-2026-73421 / GHSA-8fpg-xm3f-6cx3: `next-auth` fails open on Auth.js config errors [FIXED]

**STRIDE:** Spoofing, Elevation of Privilege
**CVSS:** Critical (GitHub Advisory Database severity: critical)

**Evidence:** `npm audit --omit=dev` (production dependency tree only, per task instructions —
not just devDependencies) reported `next-auth` (pinned `5.0.0-beta.25`, transitively pulling
`@auth/core@0.37.2`) as **critical**, matching advisory
[GHSA-8fpg-xm3f-6cx3](https://github.com/advisories/GHSA-8fpg-xm3f-6cx3) /
CVE-2026-73421, affecting `next-auth` `>=5.0.0-beta.0 <=5.0.0-beta.31`. WebSearch (Sept 2026,
freshness-protocol Tier 1 — active security advisory) confirmed:

> Applications that gate access by checking only for the existence of the `auth` object returned
> by the `auth()` wrapper can fail open when Auth.js has a server configuration error — the
> `auth` object is populated with a truthy error object instead of being `null`, so `if (!auth)`
> / `!!auth` checks evaluate to `true` for every request, including unauthenticated ones.

**Why this is directly exploitable in this codebase, not theoretical:** `services/app/src/proxy.ts:54`
uses exactly the vulnerable pattern for every `/api/*` route (the entire tenant API surface):

```ts
if (!req.auth) {
  return NextResponse.json({ code: "UNAUTHORIZED", ... }, { status: 401 });
}
return NextResponse.next();
```

and line 78 uses the analogous pattern for every protected tenant page. If Auth.js hits a server
configuration error at request time (misconfigured `AUTH_SECRET`, a provider error, any of the
several failure modes the advisory enumerates), `req.auth` becomes a truthy error object instead
of `null`/`undefined`, `!req.auth` evaluates to `false`, and the proxy lets the request through as
if authenticated — for every tenant route and every protected page, simultaneously, platform-wide,
for as long as the misconfiguration persists. This is a full authentication bypass, not a
narrow edge case.

**Fix applied:** bumped `next-auth` `5.0.0-beta.25` → `5.0.0-beta.32` in
`services/app/package.json` (the exact version the advisory names as fixed — verified via
WebSearch against the GitHub Advisory Database and `npm view next-auth versions`, which confirms
`5.0.0-beta.32` is also the current latest published version, i.e. this is not a partial/interim
fix). `npm install --workspaces --include-workspace-root` was re-run to update
`package-lock.json`, and `npm run prisma:generate` was re-run afterward (a fresh `node_modules`
drops the generated Prisma client, which briefly broke `tsc --noEmit` across ~15 files until
regenerated — this is expected after any full reinstall, not a regression from the version bump
itself).

**Verification performed (this session, no Docker required):**
- `npm audit --omit=dev` **before** fix: 2 critical (`next-auth`, `@auth/core`), 0 elsewhere.
- `npm audit --omit=dev` **after** fix: `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`
  — production dependency tree is clean.
- `bash Claude-Production-Grade-Suite/.orchestrator/oracle.sh` (typecheck + lint, both workspaces): green.
- `npm run test --workspaces` (all co-located unit tests, 5+8 files): 75/75 passing, no regressions.
- `npm run test:qa:unit` (QA's own unit suite): 1 file / 7 tests, unaffected, passing.
- `npm run build`: green — all 46 API routes + 28 pages compiled successfully against
  `next-auth@5.0.0-beta.32`.
- **Not verified (Docker unavailable in this worktree):** an actual live request against a running
  app with a deliberately broken Auth.js config, confirming the *old* version failed open and the
  *new* version fails closed. This is a supply-chain/dependency-version fix, not app logic I
  wrote — the upstream advisory's own fix commit (replacing raw JSON parsing with a validated
  `parseSessionResponse` handler) is the actual behavioral change, and it is out of this repo's
  code to re-verify beyond confirming the patched version is installed and the app still builds
  and passes all tests against it. **Verify against the running stack:** boot the app with an
  intentionally invalid Auth.js config (e.g. temporarily blank `AUTH_SECRET` in a non-dev-guarded
  path) and confirm `/api/stock/movements` (or any protected route) returns 401, not 200.

**Residual devDependency vulnerabilities (not fixed, not blocking):** `npm audit` (full, including
devDependencies) still reports 8 vulnerabilities (1 critical: `vitest`; 4 high: `prisma`,
`@prisma/config`, `deepmerge-ts`, `vite`; 3 moderate) — all in the `vitest`/`prisma` CLI toolchain,
never imported by runtime application code, not reachable from any HTTP-facing path. These are
tracked as a **Medium** finding below (`M-7`) because `services/app/Dockerfile` currently copies
the *full* `node_modules` — including devDependencies — into the production runtime image, so
these unreachable-but-present CVEs would show up in a container image scan even though nothing
in the running app ever invokes `vitest`/`prisma` CLI code paths.
