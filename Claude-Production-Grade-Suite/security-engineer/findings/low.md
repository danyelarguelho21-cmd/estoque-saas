# Low Findings — Wave A Threat Model (estoque-saas)

SLA per severity standard: fix within 1 quarter. Framed as Wave B verification checklist items unless marked **[GROUNDED IN CODE]**.

---

## L-1 — Weak default `POSTGRES_PASSWORD` fallback in docker-compose [GROUNDED IN CODE]

**STRIDE:** Spoofing
**Evidence:** `docker-compose.yml:7` — `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-devpassword}`; `.env.example:4` mirrors the same default.
**Why it matters:** Acceptable for local dev, but a silent fallback means a misconfigured production deploy missing this env var would boot with a well-known weak password instead of failing loudly.
**Required control:** DevOps deployment pipeline/docs must assert `POSTGRES_PASSWORD` is explicitly set (no default) in any non-dev environment — fail the deploy, don't fall back.
**Wave B verification:** confirm production deployment tooling (DevOps skill's output) rejects boot with the placeholder value or an unset variable.

---

## L-2 — Placeholder secrets in `.env.example` need boot-time validation in non-dev environments [GROUNDED IN CODE]

**STRIDE:** Spoofing, Tampering
**Evidence:** `.env.example:11` `AUTH_SECRET=changeme-generate-with-openssl-rand-base64-32`; `PAGBANK_WEBHOOK_SECRET=`, `PLATFORM_ADMIN_BOOTSTRAP_PASSWORD=` are blank placeholders.
**Why it matters:** Same class as L-1 — a blank/placeholder `AUTH_SECRET` in production would weaken or break session signing; a blank `PAGBANK_WEBHOOK_SECRET` would (per Finding C-4) make webhook signature verification either fail open or fail to start, depending on implementation.
**Required control:** boot-time assertion that rejects startup if any of these remain empty or equal to their documented placeholder value when `NODE_ENV=production` (or equivalent).
**Wave B verification:** attempt to start the app with a blank `AUTH_SECRET`/`PAGBANK_WEBHOOK_SECRET` in a production-like env config and confirm it refuses to boot rather than degrading silently.

---

## L-3 — No platform-level audit trail for `platform_admin` actions (suspend/reactivate tenant)

**STRIDE:** Repudiation
**Evidence:** `api/openapi/admin.yaml:49-70` (`suspendTenant`, `reactivateTenant`) have no associated audit mechanism designed. The existing `audit_log` table is `tenant_id`-scoped and RLS-protected (`0001_init.sql:300-311`), which by construction cannot record platform-level actions that aren't tied to a single tenant's RLS context.
**Why it matters:** A `platform_admin` suspending or reactivating a tenant (e.g. contested as retaliatory, mistaken, or the result of a compromised platform_admin account) currently leaves no "who/when/why" trail — same repudiation concern ADR-007 addresses for tenant data, just unaddressed for the platform side.
**Required control:** add a global (RLS-disabled, alongside `plans`/`platform_admins`) `platform_audit_log` table with the same GRANT-restricted append-only pattern as `audit_log`, recording `platform_admin_id`, action, target `tenant_id`, timestamp, and reason (BRD doesn't currently require a `reason` field on suspend/reactivate — recommend adding one).
**Wave B verification:** confirm a platform-admin suspend/reactivate action produces a durable, immutable record.

---

## L-4 — Cross-tenant barcode/EAN matching risk (informational — control confirmed adequate)

**STRIDE:** Information Disclosure (assessed, not found)
**Evidence:** `nfe_import_items.c_ean` matching against `products.barcode` (ADR-005 §2) occurs within a `withTenant()`-scoped operation, and `products`/`nfe_import_items` both carry direct `tenant_id` columns with RLS policies (`0001_init.sql` RLS loop, lines 317-344).
**Assessment:** No cross-tenant barcode collision/matching risk by design — matching is inherently scoped to the caller's tenant. Included here as a positive control note, contingent on Finding C-1 being resolved (without it, this control — like all RLS-dependent controls — is currently inert).

---

## L-5 — No protection against demoting/disabling the last remaining `admin` of a tenant

**STRIDE:** (Availability/business-logic, adjacent to Elevation of Privilege in H-2)
**Evidence:** `api/openapi/tenants.yaml:96-115` (`PATCH /api/users/{userId}/role`) has no documented guard against a tenant ending up with zero `admin` users.
**Why it matters:** Not a classic security vulnerability, but an operational lockout risk — a tenant with no admin cannot manage users, billing, or company settings without support intervention, and could be exploited as a denial-of-service by a compromised or disgruntled account if not guarded.
**Required control:** the role-change and user-disable handlers should reject an operation that would leave a tenant with zero active `admin` users.
**Wave B verification:** attempt to demote/disable the sole admin of a test tenant and confirm the operation is rejected.
