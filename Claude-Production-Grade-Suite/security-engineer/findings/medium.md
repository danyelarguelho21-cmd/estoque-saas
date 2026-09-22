# Medium Findings — Wave B CODE-LEVEL Audit (estoque-saas)

Supersedes the Wave A version of this file (preserved in git history). SLA per severity standard:
fix within 1 sprint. Not auto-fixed per task scope (Critical/High only) — documented for the
remediation backlog.

---

## Wave A mediums — verification result

| ID | Wave A finding | Wave B status |
|----|----------------|----------------|
| M-1 | Password hashing algorithm/parameters not chosen | **CLOSED.** `services/app/src/modules/auth/password.ts` — `bcryptjs`, `SALT_ROUNDS = 12`, matching the Wave A guidance floor exactly (Argon2id was the preferred option; bcrypt ≥12 is the documented acceptable fallback). Applied identically to `platform_admins` (`modules/admin/auth.ts:12`, same `bcrypt.compare`). |
| M-2 | Platform-admin/tenant session separation unverified in (nonexistent) code | **CLOSED.** `proxy.ts` was read in full: `/api/platform-admin/*` is in `PUBLIC_API_PREFIXES` (exempt from the NextAuth `req.auth` check) but every platform-admin route handler independently calls `requirePlatformAdmin()` (`modules/admin/auth.ts`), which reads only the `__Host-platform-session`/`platform-session-dev` cookie via a completely separate HMAC-signed token (`modules/admin/session.ts`) — never NextAuth. A tenant session cookie alone cannot satisfy `requirePlatformAdmin()` (different cookie name, different verification code path entirely), and a platform-admin session cookie alone cannot satisfy `requireSession()` (reads `auth()`/NextAuth JWT only). Symmetric, correctly separated. |
| M-3 | Audit log completeness depends on manual `recordAudit()` calls | **Still open, unchanged, as designed.** `libs/shared/src/audit/index.ts` remains a plain function; no DB trigger or ORM-level enforcement exists. This was already scoped in Wave A as "track as HARDEN backlog, not block on it" — no regression, no new gap found, spot-checked several mutation paths (`updateUserRole`, `confirmNfeImport`, `processPagBankWebhook`) and all correctly call `recordAudit()` within the same transaction. Recommend QA add the integration-test coverage Wave A specified (enumerate every mutation path, assert a matching `audit_log` row) — this is QA's `tests/` tree, not mine to add. |
| M-4 | Generic error responses risk leaking internal details | **CLOSED.** `libs/shared/src/errors/index.ts::toErrorResponse` — unknown (non-`AppError`) exceptions always map to a fixed `{code: "INTERNAL_ERROR", message: "Erro interno inesperado."}`, never the caught error's `.message`/stack. `AppError.details` is only ever set by domain code passing intentional, allow-listed data (Zod issue arrays, `{productId}`, etc.) — never a raw exception. Verified via `errors/index.test.ts`'s existing "never leaks internal error messages" case, still passing. |
| M-5 | LGPD data-subject rights not addressed in BRD/ADRs | **Still open — PM-authority item, not a code finding.** No code change is in scope for this; re-flagging per Wave A's own framing (Security Engineer identifies, Product Manager owns remediation via BRD user stories). |
| M-6 | NF-e import confirmation should re-validate `nfeImportItemId` ownership beyond RLS | **CLOSED by construction — stronger than the Wave A ask.** Read `modules/stock/nfe-import.ts::confirmNfeImport` in full: the mutation loop iterates `nfeImport.items` (fetched server-side, scoped to the `importId` path param which is itself tenant-scoped via `withTenant()` + `findUnique`) — it does **not** iterate the client-submitted `itemOverrides` array. The client's `nfeImportItemId` values are only used as a `Map` lookup key to find an *optional* batch/expiry override for an item the server already decided is in scope; a submitted ID from a different import (even the same tenant's) simply matches nothing and is silently ignored, never redirected to corrupt an unrelated import. No cross-import mutation is possible by construction, independent of RLS. |

---

## NEW — M-7: devDependency CVEs ship into the production Docker image

**STRIDE:** Information Disclosure / supply chain (defense-in-depth, not directly exploitable)
**Evidence:** `npm audit` (full tree, including devDependencies) reports 8 vulnerabilities not
present in `npm audit --omit=dev`: `vitest` (critical, ≤4.1.10), `prisma`/`@prisma/config` (high,
CLI tooling), `deepmerge-ts` (high), `vite`/`vite-node`/`esbuild` (moderate/high) — all transitive
to the `vitest`/`prisma` devDependency toolchain, never imported by any runtime `services/app/src`
or `libs/shared/src` code path. However, `services/app/Dockerfile`'s `runtime` stage does
`COPY --from=build /repo/node_modules ./node_modules` — copying the **entire** `node_modules`
(built via `npm install --workspaces --include-workspace-root`, which installs dev+prod together)
into the final image, not a pruned production-only tree.
**Why it matters:** these CVEs are not reachable at runtime (nothing in the running `next start`
process or the worker ever calls into `vitest`/`prisma` CLI code), but they inflate the deployed
image's attack surface and will surface as findings in any container image CVE scan (DevOps
skill's domain per `conflict-resolution.md` — flagging here since I'm the one who found it during
the dependency audit).
**Recommended control (routed to DevOps):** add an `npm ci --omit=dev` (or workspace-equivalent)
production-install stage and copy `node_modules` from *that* stage into `runtime`, instead of
reusing the `build` stage's full install. Out of scope for me to change (Dockerfile/image
composition is the DevOps skill's authority per the scope boundary in this skill's own
instructions) — documented here for the HARDEN→remediation handoff.

## NEW — M-8: no structural/compile-time guard against future `platformPrisma` misuse for tenant data

**STRIDE:** Tampering, Information Disclosure (latent, not currently triggered — see H-1 above)
**Evidence:** `libs/shared/src/db/client.ts` still exports `platformPrisma` as a plain, untyped
`PrismaClient` reference with no marker distinguishing it from a tenant-safe client. This exact
bug class was introduced and fixed three separate times across Wave A/B (per `tasks.md`'s own
commit history) — the current audit found zero live instances, but nothing in the type system
prevents a fourth occurrence.
**Recommended control:** add an ESLint rule (e.g. `no-restricted-imports` scoped to
`services/app/src/modules/**` excluding `modules/admin/**`, `modules/billing/plans.ts`, and the
specific `SECURITY DEFINER` lookup call sites) that flags any new `platformPrisma` import outside
an explicit allowlist. This is a Code Reviewer/lint-configuration change, not a runtime fix —
noting it here since it's the direct, actionable mitigation for a finding I (Security Engineer)
am the sole authority on identifying.

## NEW — M-9: no worker-level per-job timeout or per-tenant concurrency limit for NF-e/CSV parsing jobs

**STRIDE:** Denial of Service (residual after H-3's size-cap fix)
**Evidence:** `services/app/src/worker/index.ts` — BullMQ `Worker` instances for `parse-nfe` and
`import-products-csv` have no `limiter` (per-queue rate) or per-tenant concurrency configuration;
the size cap added for H-3 closes the *unbounded* version of the resource-exhaustion risk (a
500MB+ file can no longer be uploaded at all), but a tenant could still enqueue many
just-under-the-cap (10MB XML / 20MB CSV) jobs back-to-back and consume a disproportionate share of
the single shared worker's time versus other tenants' billing/alert jobs.
**Recommended control:** BullMQ's `Worker` constructor `limiter: { max, duration }` option, scoped
per-tenant via a custom `jobId`/group key, or a separate queue per priority tier. DevOps/SRE
infrastructure-configuration concern, not application code — noted for remediation planning.
