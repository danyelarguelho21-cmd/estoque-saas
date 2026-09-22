# Medium Findings — Wave A Threat Model (estoque-saas)

SLA per severity standard: fix within 1 sprint of being confirmed against real code. Framed as Wave B verification checklist items unless marked **[GROUNDED IN CODE]**.

---

## M-1 — Password hashing algorithm/parameters not yet chosen; must use current 2026 guidance

**STRIDE:** Information Disclosure (credential compromise on DB breach)
**Evidence:** `users.password_hash` and `platform_admins.password_hash` exist as columns (`schemas/migrations/0001_init.sql:26,50`; `libs/shared/prisma/schema.prisma:32,69`) with no hashing implementation anywhere in the repo yet.

**Required control (WebSearch-verified, 2026-09):** OWASP Password Storage Cheat Sheet currently ranks **Argon2id** first — parameters `t=3, m=64MiB, p=1` (or the equally strong `m=46MiB, t=1` alternative if CPU time is the binding constraint). **bcrypt** is an acceptable fallback only if an Argon2 library is unavailable, with cost factor `>= 12` (13 preferred) — cost `< 10` is no longer considered safe. Apply identically to both `users` and `platform_admins`, with no weaker treatment for the platform-admin table despite it being outside RLS — if anything, its outsized blast radius argues for the stronger end of the parameter range.

**Wave B verification:** inspect the hashing call site; confirm algorithm + parameters match the above (re-verify current guidance at implementation time — Tier 3 freshness, changes over quarters) and that bcrypt's 72-byte truncation limitation (if bcrypt is used) is either documented or mitigated (pre-hash long inputs).

---

## M-2 — Platform-admin/tenant session separation is sound in the contract, but unverified in (nonexistent) code

**STRIDE:** Spoofing, Elevation of Privilege
**Evidence:** `api/openapi/_common.yaml:11-20` defines two distinct cookie-based security schemes (`sessionCookie` → `__Host-session`, `platformSessionCookie` → `__Host-platform-session`); `api/openapi/admin.yaml:8` applies `security: [{ platformSessionCookie: [] }]` at the document level; `design-principles.md:28` states the platform panel "usa autenticação e sessão **completamente separadas**." The contract is correctly designed.

**Why it matters:** This guarantee only holds if every `/api/platform-admin/*` Route Handler specifically checks for the platform session type — not just "a session exists." This is exactly boundary-safety.md's Pattern 4 ("global interceptors must branch, never return a hardcoded/blanket result"): a middleware/`proxy.ts` implementation that checks "is there *any* valid Auth.js session" without distinguishing which cookie/session table it came from would silently let a tenant `admin` session into the platform panel, or vice versa. Compounded by H-4 (Auth.js v5 + Next.js 16 beta pairing), this is a plausible, not merely theoretical, implementation risk.

**Required control:** `proxy.ts`/route-level guards for `/api/platform-admin/*` must explicitly validate the `__Host-platform-session` cookie against the `platform_admins` session store, and must explicitly reject (not merely ignore) a valid `__Host-session` tenant cookie presented instead. Symmetric check required in the tenant-side middleware.

**Wave B verification:** end-to-end test (per boundary-safety Pattern 5): log in as a tenant admin, attempt to call `/api/platform-admin/tenants` with only the tenant session cookie present → expect 401, not empty results. Log in as a platform_admin, attempt to call a tenant route (e.g. `/api/stock/movements`) with only the platform session cookie → expect 401.

---

## M-3 — Audit log completeness depends on manual `recordAudit()` calls, not an enforced interceptor [GROUNDED IN CODE]

**STRIDE:** Repudiation
**Evidence:** `libs/shared/src/audit/index.ts` implements `recordAudit()` as a plain async function taking a `tx` and `AuditContext`; nothing in the module system, ORM extension, or middleware calls it automatically for mutations. The comment at the top acknowledges the convention ("toda mutação de domínio que precisa de trilha de auditoria passa por `withAudit()`") but this is enforced only by developer discipline.

**Why it matters:** Unlike RLS (Postgres-enforced regardless of app code, once C-1 is fixed) and unlike the GRANT-based immutability ADR-007 targets (protects *existing* rows from tampering, once C-2 is fixed), nothing prevents a mutation handler from simply forgetting to call `recordAudit()`. This produces a silent gap — no error, no failed test by default — undermining the "toda movimentação de estoque gera um registro de auditoria imutável" acceptance criterion (BRD) and reducing the audit trail's value as LGPD/billing-dispute evidence. ADR-007 itself names this exact trade-off and defers trigger-level enforcement to future hardening.

**Required control:** At minimum, QA Engineer should write integration tests enumerating every mutation code path (stock movements, sale creation, transfers, user role changes, plan changes, tenant status changes) and assert a matching `audit_log` row exists in the same transaction. Given the business criticality here (LGPD + billing-dispute evidence), recommend promoting ADR-007's "future hardening" trigger-level enforcement into the current HARDEN backlog rather than leaving it purely aspirational — a lightweight Postgres trigger that raises/logs when a tracked table is mutated without a corresponding same-transaction `audit_log` insert is a structurally stronger guarantee than code review or test coverage alone.

**Wave B verification:** for each mutation type, confirm an integration test asserts audit-row creation; attempt to intentionally skip `recordAudit()` in a test double and confirm the QA suite catches it (i.e., the coverage is real, not just present in the happy path).

---

## M-4 — Generic error responses risk leaking internal details via the free-form `details` field

**STRIDE:** Information Disclosure
**Evidence:** `api/openapi/_common.yaml:47-62` `Error` schema includes `details: { type: object, additionalProperties: true }` alongside `trace_id`.

**Why it matters:** A free-form, unconstrained `details` object is a plausible sink for a generic exception handler to "helpfully" serialize a caught error's `.message`/`.stack` into the API response — which could reveal internal file paths, Prisma/Postgres error text (potentially including table/column names or fragments of the query), or even hint at the current `app.tenant_id` context. This is a common real-world source of information disclosure that automated scanners rarely catch because it only appears on the *unhappy* path.

**Required control:** The global error handler must map internal exceptions to a small, allow-listed set of `code`/`message` values. Raw exception objects, stack traces, and DB driver error text must never reach `details` for tenant- or platform-admin-facing responses. `trace_id` should correlate to server-side structured logs (12-factor "logs as stream" per design-principles.md) rather than embedding request/user data itself.

**Wave B verification:** trigger a DB constraint violation, a Prisma error, and an unhandled exception via each API surface; confirm the JSON response's `details` (if present) contains only intentionally-exposed, non-internal fields.

---

## M-5 — LGPD data-subject rights (access/correction/deletion/portability) not addressed anywhere in BRD/ADRs

**STRIDE:** Information Disclosure (indirectly — regulatory/compliance gap)
**Evidence:** `Claude-Production-Grade-Suite/product-manager/BRD/constraints.md:16-17` explicitly defers LGPD detail to "Security Engineer na fase HARDEN," but neither the BRD's "Out of Scope" section nor any ADR mentions data-subject rights (LGPD Art. 18: access, correction, anonymization/deletion, portability) for `customers` (end-customer PII: `document`, `phone`, `email` — `0001_init.sql:222-230`) or for tenant users' own data.

**Why it matters:** This is a genuine LGPD compliance gap, not a code vulnerability — flagged here because Security Engineer is the sole authority on PII/compliance findings, but the *remediation* (adding user stories/acceptance criteria) is Product Manager's authority per `conflict-resolution.md`. This finding is a formal cross-functional flag, not a claim that Security Engineer can add these requirements unilaterally.

**Required control (recommendation, routed to PM):** add BRD user stories covering, at minimum: end-customer data deletion/anonymization on request, tenant admin's ability to export/delete a specific customer's data, and a documented data-retention policy for `audit_log`/`stock_movements` (which by design retain historical `customer_id` references indefinitely).

**Wave B verification:** N/A for code audit — track as a PM backlog item; Security Engineer re-confirms scope once BRD is updated (if it is).

---

## M-6 — NF-e import confirmation should re-validate `nfeImportItemId` tenant ownership beyond RLS alone

**STRIDE:** Tampering
**Evidence:** `api/openapi/stock.yaml:138-168` (`POST /api/nfe-imports/{importId}/confirm`) accepts a list of `{nfeImportItemId, batchNumber, expiryDate}` objects. `nfe_import_items` is `tenant_id`-scoped and RLS-protected (`0001_init.sql:204-216`, included in the RLS loop), so cross-tenant reads/writes should already be blocked at the DB layer once C-1 is fixed.

**Why it matters:** Defense in depth: an IDOR-style test (a tenant operador submitting another tenant's `nfeImportItemId` guessed/observed via a shared UUID space) should fail at the RLS layer, but the handler should also explicitly verify each submitted `nfeImportItemId` belongs to the `importId` being confirmed (not just to the caller's tenant) — otherwise a user could reference a *different, own-tenant* import's item ID to corrupt an unrelated import's confirmation state.

**Wave B verification:** submit a confirm request mixing `nfeImportItemId`s from two different `nfe_imports` (both belonging to the same tenant) and confirm the handler rejects the mismatch rather than silently accepting it.
