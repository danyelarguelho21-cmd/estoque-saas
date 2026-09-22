# High Findings — Wave A Threat Model (estoque-saas)

SLA per severity standard: fix within 1 week of being confirmed against real code. Framed as Wave B verification checklist items unless marked **[GROUNDED IN CODE]**.

---

## H-1 — Nothing structurally prevents tenant-scoped queries from bypassing `withTenant()`

**STRIDE:** Tampering, Information Disclosure
**Evidence:** `libs/shared/src/db/client.ts` exports exactly two things: `withTenant()` and `platformPrisma` (`= basePrisma`, a plain `PrismaClient`, typed with no marker distinguishing "safe for platform-only use"). Nothing in the type system or module boundary (ADR-001's lint-enforced module boundaries only govern cross-*module* imports, not this specific usage pattern) stops a future `services/app/src/modules/*` file from importing `platformPrisma` directly for a tenant-scoped query "just this once."

**Why it matters:** If Finding C-1 (superuser role) is fixed correctly, a `platformPrisma` misuse for a tenant query is merely a bug that returns zero rows / 500s (RLS still fail-closed without `set_config`). If C-1 is **not** fixed, the same misuse is a full cross-tenant data leak. Either way it's a real defect this design invites.

**Required control:** At Wave B, grep the entire `services/app` tree for any import of `platformPrisma` outside the platform-admin module, and any direct `new PrismaClient()` instantiation outside `libs/shared/src/db/client.ts`. Recommend the Backend/QA Engineers extend the automated "every `tenant_id` table has RLS enabled" test (already promised in ADR-002's Consequences) into a companion static check: no tenant-domain module file may reference `platformPrisma`.

---

## H-2 — RBAC is not encoded in the API contract; role checks are free-text comments, not a machine-checkable rule

**STRIDE:** Elevation of Privilege
**Evidence:** Across `api/openapi/*.yaml`, role restrictions appear only as prose in `summary` fields — e.g. `tenants.yaml:18` `"Atualiza configurações do tenant (apenas admin)"`, `tenants.yaml:78` `"Lista usuários do tenant (apenas admin)"`, `tenants.yaml:103` `"Altera papel de um usuário (apenas admin)"` — with no OpenAPI vendor extension (e.g. `x-required-roles`) or consistent annotation. Several endpoints with an obvious access-control implication carry no such note at all (e.g. `PATCH /api/stores/{storeId}`, `POST /api/stores`).

**Why it matters:** BRD Business Rules are explicit and strict: vendedor must have **no access to configurações, custos de fornecedor, or cobrança**. Because the contract doesn't machine-encode role requirements, there is no automatic way for Wave B (or CI) to verify RBAC completeness from the spec alone — it depends entirely on each Route Handler being implemented correctly and consistently by hand. Concrete escalation scenario: a `vendedor` session calls `PATCH /api/users/{ownUserId}/role` with `{"role":"admin"}` directly (bypassing any hidden UI control). If the handler checks `session exists` but not `session.role === 'admin'`, the self-escalation succeeds instantly, granting the vendedor access to billing, company settings, and supplier cost data the BRD explicitly forbids them.

**Required control:**
1. Every mutating endpoint must have an explicit, server-side role check — never rely on hiding UI affordances.
2. Recommend adding a lightweight `x-required-roles: [admin]` (or similar) OpenAPI extension to every operation as the pipeline matures, so RBAC becomes machine-verifiable against the implementation (QA/Code Reviewer can diff route-handler role checks against the contract).
3. Add an explicit guard preventing the last remaining `admin` of a tenant from being demoted or disabled (operational lockout, tracked separately as L-5, but worth catching in the same role-change handler).

**Wave B verification:** for every `role: [admin]`-implied endpoint, write an integration test asserting a 403 for both `operador` and `vendedor` sessions, and specifically test the self-escalation path (`vendedor` PATCHes their own role).

---

## H-3 — NF-e XML upload has no declared size limit, parser resource guard, or per-tenant rate/quota control

**STRIDE:** Denial of Service
**Evidence:** `api/openapi/stock.yaml:100-121` (`POST /api/nfe-imports`) declares `file: { type: string, format: binary }` with no `maxLength`/size constraint. ADR-005 confirms parsing is async (BullMQ, correctly keeps the web thread free) but specifies no worker-side timeout, memory ceiling, or per-tenant concurrency/rate limit. Per ADR-001, the background worker is a **single shared process** across all tenants — there is no per-tenant isolation at the job-execution level.

**Why it matters:** Any authenticated user with NF-e upload permission (operador, at minimum) can upload an extremely large XML or a deeply-nested/repetitive structure designed to maximize parse cost. Because the worker is shared across the whole platform (ADR-001), one tenant's malicious or merely careless upload (e.g., accidentally uploading a 500MB file) can starve CPU/memory for every other tenant's NF-e imports, billing-cycle jobs, and validity/low-stock alert jobs, which per ADR-003 share the same BullMQ/Redis-backed worker.

**Required control:**
1. Enforce a maximum upload size at the API boundary (e.g. multipart body-size limit in the Route Handler and/or reverse proxy `client_max_body_size`) — reject oversized files before they reach storage or the queue.
2. Configure `fast-xml-parser` with reasonable depth/size guards in addition to the entity-processing hardening in Finding C-5.
3. Add a BullMQ job-level timeout and a per-tenant concurrency/rate limit for `nfe-import` jobs so one tenant cannot starve the shared worker.
4. Consider a per-tenant storage quota for uploaded NF-e files (`FileStorage` interface per ADR-005).

**Wave B verification:** attempt to upload a file above the configured limit → expect rejection before the job is enqueued. Load-test the worker with several large-but-under-limit concurrent uploads from one tenant and confirm another tenant's alert/billing jobs are not meaningfully delayed.

---

## H-4 — Auth.js v5 + Next.js 16 pairing is beta/unsupported — elevated risk of session/middleware wiring bugs

**STRIDE:** Spoofing, Elevation of Privilege
**Evidence:** ADR-003 (`docs/architecture/architecture-decision-records/ADR-003-tech-stack.md:30`) itself documents: *"o pacote `next-auth@5.0.0-beta.25` ainda não publicou `peerDependencies` cobrindo Next.js 16... Instalação requer `legacy-peer-deps=true`... reavaliar quando `next-auth` sair de beta."* Next.js 16 also renamed `middleware.ts` to `proxy.ts`, which is exactly where session/tenant-context/role enforcement is expected to live (per design-principles.md's zero-trust-internal principle: "Toda Route Handler valida sessão + papel + tenant... via middleware de permissão").

**Why it matters:** This is a compounding risk factor, not a standalone vulnerability: every other session/RBAC finding in this document (H-2, M-2, T1/T2/T14/T15 in the STRIDE table) is more likely to manifest as a real bug given the two frameworks' beta-level compatibility. A `proxy.ts` misconfiguration or a `next-auth` v5-beta edge case affecting cookie/session handling would undermine multiple controls at once.

**Required control:** Wave B code audit should give extra scrutiny to `proxy.ts` and all Auth.js configuration, specifically testing the two full auth journeys end-to-end (tenant login → protected route → correct tenant_id in session; platform_admin login → protected route → platform session correctly rejected by tenant routes and vice versa) rather than trusting unit-level checks alone (per boundary-safety.md Pattern 5).

---

## H-5 — No rate limiting / brute-force protection on `/api/auth/login`, `/api/auth/signup`, or `/api/platform-admin/login`

**STRIDE:** Denial of Service, Spoofing
**Evidence:** Repo-wide grep for rate-limit/throttle/captcha/brute-force terminology found zero references outside the pipeline's own protocol files (`.protocols/*.md`) — i.e., nothing in the actual architecture docs, ADRs, or OpenAPI specs addresses this.

**Why it matters:**
- `/api/auth/login` and `/api/platform-admin/login` are both Credentials-based (email/password) — without rate limiting, both are exposed to credential-stuffing and brute force.
- `/api/platform-admin/login` is the highest-blast-radius credential in the system: a compromised `platform_admin` account can view MRR/churn/all-tenant data and suspend/reactivate **any** tenant (`api/openapi/admin.yaml:49-70`). It deserves stricter protection than tenant login, not equal protection.
- `/api/auth/signup` is unauthenticated and creates a full tenant + admin user per call — without rate limiting, it's exposed to mass fake-tenant creation (resource exhaustion, spam, and potential plan-limit-check abuse).

**Required control:** IP- and account-based rate limiting with exponential backoff/lockout on all three endpoints; strongly recommend mandatory 2FA (or at minimum, WebAuthn/TOTP option) for `platform_admins` given the asymmetric blast radius, even though this exceeds current BRD scope — flag to Product Manager as a recommendation for the platform-admin panel specifically.

**Wave B verification:** confirm middleware/library-level rate limiting exists and fires (e.g., 6 failed logins from one IP/account within N minutes → 429), and that platform-admin login has an equal-or-stricter policy than tenant login.
