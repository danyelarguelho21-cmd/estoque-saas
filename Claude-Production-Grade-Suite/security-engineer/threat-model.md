# STRIDE Threat Model — estoque-saas

**Status:** Wave A (BUILD phase) — DESIGN-LEVEL threat model.
**Scope note:** No application code exists yet for the services being audited here (Backend/Frontend Engineers are building in parallel, Wave A). This document analyzes the **architecture as specified** in the BRD, ADRs, OpenAPI contracts, the SQL migration (`schemas/migrations/0001_init.sql`), the Prisma schema, and the `libs/shared/*` scaffolding that already exists (payments provider interface, `withTenant()` DB client, audit wrapper, `docker-compose.yml`, `.env.example`). Where scaffolding code already exists, findings below are grounded in it directly (file:line cited). Where code does not yet exist, findings are framed as **MUST-VERIFY** checklist items for the Wave B code audit (Security Engineer HARDEN pass) once the Backend/Frontend Engineers finish implementation.

Author: Security Engineer (sole authority on OWASP/STRIDE/PII/encryption per `conflict-resolution.md`).

---

## 1. System & Trust Boundaries

```
[Browser: tenant user]          [Browser: platform_admin]
        |  __Host-session cookie          |  __Host-platform-session cookie
        v                                  v
  ┌─────────────────────────────────────────────┐
  │  Next.js App Router (single deployable)      │
  │  Route Handlers: /api/{auth,tenants,stock,   │
  │  sales,catalog,billing,dashboard}/*          │  <- tenant trust boundary
  │  Route Handlers: /api/platform-admin/*       │  <- platform trust boundary (separate)
  │  Route Handler: /api/webhooks/pagbank        │  <- external/unauthenticated trust boundary
  └───────────────┬───────────────────┬──────────┘
                  │ withTenant()      │ platformPrisma (no RLS ctx)
                  v                   v
        ┌────────────────────────────────────┐
        │ PostgreSQL 18 (single shared schema) │  <- RLS enforcement boundary (ADR-002)
        │ role: estoque_app (see C1 below)     │
        └────────────────────────────────────┘
                  ^
                  │ BullMQ job (worker process, shared across ALL tenants)
        ┌────────────────────┐
        │ NF-e XML parser job │  <- untrusted-file trust boundary (ADR-005)
        │ (fast-xml-parser)   │
        └────────────────────┘
                  ^
                  │ multipart upload
        [Browser: operador — supplier-provided XML, semi-trusted content]

[PagBank] --webhook POST (unauthenticated, HMAC-signed)--> /api/webhooks/pagbank  <- external trust boundary
```

Five trust boundaries matter most for this threat model:
1. **Tenant session ↔ App** — every tenant Route Handler.
2. **Platform-admin session ↔ App** — `/api/platform-admin/*`, architecturally required to be non-overlapping with (1).
3. **App ↔ Postgres RLS** — the boundary the entire multi-tenant isolation promise (BRD, ADR-002) rests on.
4. **PagBank ↔ Webhook endpoint** — unauthenticated by session, authenticated only by signature.
5. **Uploaded NF-e XML ↔ Parser** — attacker-influenced (any operador can upload) file content reaching `fast-xml-parser` and, later, the UI/DB.

---

## 2. STRIDE Table

| # | Category | Component | Attack Scenario | Control (specified / existing code) | Residual Risk | Severity | Finding |
|---|----------|-----------|------------------|----------------------------------------|----------------|----------|---------|
| T1 | Spoofing | Tenant session | Session fixation / cookie theft lets an attacker act as a tenant user | Auth.js v5 Credentials + `__Host-session` (forces Secure, Path=/, no Domain — blocks subdomain cookie injection) | Auth.js v5 + Next.js 16 pairing is beta/unsupported per ADR-003 note — increased risk of session wiring bugs | High | H-2 (session separation), MUST-VERIFY |
| T2 | Spoofing | Platform-admin session | Attacker reuses/forges a tenant session cookie against `/api/platform-admin/*`, or vice versa | Separate cookie name (`__Host-platform-session`), separate security scheme in OpenAPI, `platform_admins` table outside RLS/tenant model | No code yet to confirm route handlers reject the *wrong* session type explicitly (Pattern 4: global interceptors must branch) | Critical | C-4 (webhook) unrelated; session confusion tracked as **M-2** |
| T3 | Spoofing | PagBank webhook | Forged POST to `/api/webhooks/pagbank` impersonating PagBank, no valid signature | `verifyWebhookSignature()` contract exists (ADR-004) but implementation is a `throw new Error("TODO(BUILD)")` stub today | **Currently zero protection — literally unimplemented.** Precise attack modeled in §3. | Critical | **C-4** |
| T4 | Tampering | Cross-tenant DB rows | App code forgets `withTenant()` / uses raw query bypassing tenant scoping | RLS policy on every tenant table (`0001_init.sql`), fail-closed by NULL `current_setting` | Two structural breaks found: (a) single Postgres role used everywhere is very likely a **superuser**, which unconditionally bypasses RLS regardless of policy; (b) `product_store_settings` is enabled for RLS but has no `tenant_id` column | Critical | **C-1**, **C-3** |
| T5 | Tampering | `audit_log` rows | Attacker (compromised app process, insider with DB creds, or SQLi elsewhere) rewrites/deletes audit trail to cover tracks | ADR-007 promises `REVOKE UPDATE, DELETE ON audit_log FROM app_user` | The actual `REVOKE` statement is **commented out** in the migration; no role even exists to revoke from (see C-1) | Critical | **C-2** |
| T6 | Tampering | NF-e import confirmation | Operador manipulates `confirmNfeImport` payload to inject arbitrary `batchNumber`/`expiryDate` or reference another tenant's `nfeImportItemId` | `nfe_import_items` and `nfe_imports` are `tenant_id`-scoped and RLS-protected; confirmation requires explicit review step (BRD AC) | Standard IDOR-class check — MUST-VERIFY handler re-validates `nfeImportItemId` belongs to the caller's tenant's import (defense in depth beyond RLS) | Medium | M-6 (new, see findings) |
| T7 | Repudiation | Stock movements / mutations without audit row | Developer forgets to call `recordAudit()` inside a mutation handler | `withAudit()`/`recordAudit()` wrapper intended to run in the same transaction (ADR-007 §2) | Nothing *structurally* forces every mutation path to call it — a plain function call, not an interceptor/trigger. Silent gaps possible. | Medium | **M-3** |
| T8 | Repudiation | Platform-admin actions (suspend/reactivate tenant) | `platform_admins` suspends a tenant with no record of who/when/why | `audit_log` is tenant-scoped and RLS-protected; platform_admin actions are NOT tenant-scoped, so no equivalent trail exists | No platform-level audit table designed yet | Low | L-3 |
| T9 | Information Disclosure | Cross-tenant data leak | Same as T4 — RLS bypass = full cross-tenant read | See T4 controls/gaps | Critical | **C-1**, **C-3** |
| T10 | Information Disclosure | PagBank webhook payload / logs | Raw webhook payload (may contain cardholder/payment metadata) logged verbatim, or `details` field of generic `Error` response echoes internal exception text | `PaymentWebhookEvent` normalization layer (ADR-004) is designed to keep the domain from touching raw payloads; `_common.yaml` `Error.details` is free-form `additionalProperties: true` | MUST-VERIFY: raw payload never written to app logs unredacted; generic error handler never echoes stack/SQL text into `details` | Medium | **M-4** |
| T11 | Information Disclosure | NF-e XML XXE | Malicious `<!DOCTYPE>`/external entity in uploaded XML causes SSRF or local file disclosure via the parser | `fast-xml-parser` chosen (ADR-005) | **Not secure by default** — verified via WebSearch (see §4). No explicit safe-parsing config specified in ADR-005/tech-stack.md. Also a currently-patched CVE (CVE-2026-25896) affecting unpinned versions. | Critical | **C-5** |
| T12 | Denial of Service | NF-e XML upload | Huge or entity-expansion XML exhausts worker memory/CPU, starving the shared BullMQ worker (billing jobs, alert jobs) for ALL tenants | Async job processing (ADR-005) keeps the web request thread free | No declared max upload size, no parser depth/size guard, no per-tenant job rate limit specified | High | **H-3** |
| T13 | Denial of Service | `/api/auth/login`, `/api/auth/signup`, `/api/platform-admin/login` | Credential stuffing / brute force / mass fake-tenant signup | None specified anywhere in repo (grep confirmed zero rate-limit references outside protocol docs) | Full exposure today at design level | High | **H-5** |
| T14 | Elevation of Privilege | RBAC — vendedor/operador → admin | `PATCH /api/users/{userId}/role` or `PATCH /api/tenant` called directly (bypassing hidden UI) by a low-privilege user | BRD explicitly defines 3 roles with strict scope (Business Rules); OpenAPI free-text notes "(apenas admin)" on some endpoints | RBAC is **not encoded in the API contract** — only prose comments on a subset of endpoints — increasing the chance a Route Handler ships without (or with an inconsistent) server-side role check | High | **H-2** |
| T15 | Elevation of Privilege | Platform-admin ↔ tenant session confusion | A `platform_admin` session (or a tenant `admin` session) is accepted by the wrong route family due to shared/loose middleware logic | Design principle states "completamente separadas" (design-principles.md, zero-trust interno) | No code yet — MUST-VERIFY every `/api/platform-admin/*` handler checks specifically for the platform session type, not just "any session" | Critical (blast radius: full platform) | **M-2** |
| T16 | Elevation of Privilege | Last-admin lockout / self-demotion | Sole admin of a tenant demotes themselves or is demoted, leaving tenant unmanageable | Not addressed in BRD/ADRs | Business-logic gap, not classic security vuln, but operationally forces support intervention | Low | L-5 |

---

## 3. Precise Attack Models (as requested)

### 3.1 Forged PagBank webhook → arbitrary invoice marked paid

**Preconditions:** `libs/shared/src/payments/providers/pagbank.ts:32-34` currently implements `verifyWebhookSignature()` as `throw new Error("TODO(BUILD): validar assinatura...")`. This is a stub, not yet real code — but it is the exact seam Wave B must scrutinize the instant Backend Engineer fills it in.

**Attack:**
1. Endpoint `POST /api/webhooks/pagbank` is intentionally `security: []` in `billing.yaml` (correct — gateways can't send session cookies) with authentication delegated entirely to `PaymentProvider.verifyWebhookSignature()`.
2. Attacker crafts a JSON body matching `PaymentWebhookEvent`'s `charge.paid` shape: `{"type":"charge.paid","gatewayEventId":"<any-unused-uuid>","gatewayChargeId":"<target-invoice's-gateway_charge_id>","paidAt":"<now>"}` — or, if the handler naively re-derives the internal event from a raw PagBank-shaped payload, the attacker mimics PagBank's real webhook JSON shape instead.
3. POSTs it directly to the endpoint with **no signature header**, or with a garbage/self-computed one.
4. **If** the handler (not yet written) calls `verifyWebhookSignature()` and rejects on `false`/`throw`, the attack fails (matches the OpenAPI-documented `401: Assinatura inválida — evento rejeitado` — the contract is correct). **If** the handler instead only checks that a signature *header is present* (not that it's cryptographically valid), or verifies against the wrong secret/algorithm, or verifies the JSON-re-serialized body instead of the raw bytes actually signed by PagBank, the forged event is accepted.
5. Once accepted, `gateway_event_id` idempotency (unique DB constraint, `invoices.gateway_event_id`) does NOT stop a *first* forged event — it only stops replay of the same forged event twice. The invoice flips `status = 'paid'`, `subscription.status` moves to `active`, and the tenant gets full product access without ever paying PagBank.
6. A parallel variant: forging `subscription.canceled` against a **competitor's or arbitrary victim tenant's** subscription (if `gatewayChargeId`/`gatewaySubscriptionId` values are discoverable or guessable — e.g., leaked in client-side network calls during checkout, or via sequential/short IDs on the PagBank side) causes involuntary service suspension — a billing-integrity DoS.

**Required control (MUST-VERIFY at Wave B code audit):**
- Signature is verified over the **raw request body bytes** exactly as received (before any JSON parsing/re-serialization — Next.js Route Handlers must read the raw body, not `req.json()` first then re-stringify).
- Verification uses HMAC (per PagBank's actual documented scheme — re-verify at BUILD time, Tier 2 freshness) with **`crypto.timingSafeEqual`**, not `===` string comparison (timing side-channel).
- Verification happens **before** `parseWebhookEvent()` / any business logic runs; failure returns 401 and performs zero mutation.
- `PAGBANK_WEBHOOK_SECRET` has a boot-time non-empty assertion (fails to start rather than silently accepting all webhooks if the env var is missing/blank).
- `gateway_event_id` uniqueness constraint (already present, `0001_init.sql:93`) is retained as defense-in-depth against replay of a *validly-signed* but duplicated event.

### 3.2 `set_config('app.tenant_id', ..., true)` outside `withTenant()` — fail-closed verification

`libs/shared/src/db/client.ts` implements exactly the ADR-002 pattern: `withTenant()` opens a `$transaction`, runs `SELECT set_config('app.tenant_id', $1, true)` (transaction-scoped, `is_local=true`), then executes the callback. This is architecturally correct and, **on its own**, fails closed: `current_setting('app.tenant_id', true)` returns `NULL` when unset, and `tenant_id = NULL` is never true in SQL — zero rows returned, not an error, not a leak.

However, two things must be verified once code exists (fail-closed only holds if both are true):

1. **No code path queries the DB through a client that never runs `set_config` at all but also isn't `platformPrisma`.** The module only exports `withTenant()` and `platformPrisma` (`=basePrisma`, undocumented as tenant-unsafe by type — it's just a `PrismaClient`, nothing stops an engineer from importing it for a tenant query "just this once" for a perf reason). **MUST-VERIFY:** grep the entire `services/app` tree at Wave B for any import of `platformPrisma` outside the platform-admin module, and any direct `new PrismaClient()` instantiation outside `libs/shared/src/db/client.ts`.
2. **The Postgres role connecting via `DATABASE_URL` must not have `BYPASSRLS` and must not be the table owner without `FORCE ROW LEVEL SECURITY`.** This is the load-bearing assumption underneath fail-closed behavior, and it is **not currently satisfied** — see Finding **C-1**. If the connecting role is a superuser (which the current `docker-compose.yml` setup produces), `set_config`/RLS policies are evaluated but **irrelevant**: superusers bypass RLS unconditionally, and fail-closed becomes fail-**open** — every query returns every tenant's rows regardless of whether `withTenant()` was used correctly. This flips the entire threat model's most important control from "fails closed by design" to "provides no protection at all" until fixed.

**Verdict:** ADR-002's fail-closed claim is correct *about the SQL semantics of `current_setting`*, but the claim depends on a role-separation precondition that is not yet implemented anywhere in the repo (no `CREATE ROLE`, no `GRANT`/`REVOKE`, no `BYPASSRLS` handling found outside doc comments — see Finding C-1). This is the single highest-priority MUST-VERIFY item for Wave B.

### 3.3 NF-e XML XXE / entity expansion

WebSearch (2026-09, per freshness-protocol Tier 1/3 for parsing-library security posture) confirms `fast-xml-parser` is **not XXE-safe by default** — external entity / DOCTYPE processing must be explicitly disabled (`processEntities: false` and related options) by the integrating code; the library does not refuse dangerous constructs out of the box. Additionally, a disclosed vulnerability **CVE-2026-25896** (CVSS 9.3, entity-encoding bypass → XSS/injection when parsed output is later rendered into HTML/SQL/other contexts) affects `fast-xml-parser` versions prior to the **5.3.5** fix (Feb 2026). `tech-stack.md`/ADR-005 currently pin only `latest` with no version floor and no mention of safe parser options.

Since `xProd`/`cProd` (item description/code, attacker-influenced — any operador can upload any "supplier" XML) are parsed, persisted, and displayed in the conferência UI, both the classic XXE path (SSRF / local file read via crafted entities) and the CVE's injection path are reachable attack surfaces, not theoretical ones.

**Required control (MUST-VERIFY / MUST-IMPLEMENT at BUILD):**
- Pin `fast-xml-parser` to `>=5.3.5` (re-verify the current patched line at implementation time — Tier 1 volatility).
- Explicitly construct the parser with entity/DOCTYPE processing disabled.
- Defense in depth: reject any uploaded file containing a `<!DOCTYPE` declaration before it ever reaches the parser (NF-e SEFAZ XML never legitimately contains one).
- Treat all parsed string fields as untrusted downstream — confirm no `dangerouslySetInnerHTML` or equivalent unescaped render path for NF-e item data in the Frontend Engineer's conferência screen.

### 3.4 Password hashing (current 2026 guidance, WebSearch-verified)

Neither `users.password_hash` nor `platform_admins.password_hash` have an implementation yet (columns exist, `passwordHash` field mapped in Prisma; no hashing code found in `libs/shared` or elsewhere). Per OWASP Password Storage Cheat Sheet as of 2026 (WebSearch-verified):
- **Preferred: Argon2id**, parameters `t=3, m=64MiB, p=1` (or the equally-strong alternative `m=46MiB, t=1` if CPU time is the binding constraint).
- **Acceptable fallback: bcrypt**, cost factor `>= 12` (13 if affordable) — cost `< 10` is no longer considered safe against consumer GPU cracking. Note bcrypt's 72-byte input truncation (pre-hash long passwords with SHA-256 if allowing very long passphrases, or document the 72-byte effective limit to users).
- PBKDF2 only if a FIPS-compliance requirement forces it — not applicable here (BRD names LGPD, not FIPS).

This applies identically to `platform_admins` — arguably with a stricter parameter budget given the outsized blast radius of a compromised platform_admin credential (full platform visibility + tenant suspend/reactivate power).

---

## 4. Confirmed Design Strengths (do not regress these)

- `tenant_id` present on every tenant-scoped table + blanket RLS-enable loop is the right shape (modulo Finding C-3).
- `PaymentProvider` abstraction (ADR-004) correctly keeps the billing domain off the raw PagBank payload — reduces blast radius of gateway-specific parsing bugs.
- `gateway_event_id UNIQUE` constraint (`0001_init.sql:93`) gives real webhook replay-idempotency once signature verification exists.
- `__Host-` cookie prefix on both session cookies is a solid browser-enforced control (forces `Secure`, `Path=/`, forbids `Domain` attribute — blocks several cookie-injection classes) and the two sessions are named distinctly.
- Async NF-e parsing (BullMQ) correctly keeps XML parsing off the request thread (ADR-005) — right call, just needs the guards in §3.3/Finding H-3 added.
- `platform_admins` and `plans` correctly modeled as global, RLS-disabled tables, separate from the tenant model (ADR-002 §5) — the right foundation for platform/tenant separation, contingent on Finding M-2 being verified in code.
- Explicit human-review gate before NF-e stock mutation (`nfe_imports.status = pending_review` → `confirmed`) matches BRD's acceptance criterion and reduces the automated-trust attack surface.

---

## 5. Output Contract

| Artifact | Path |
|---|---|
| This threat model | `Claude-Production-Grade-Suite/security-engineer/threat-model.md` |
| Critical findings | `Claude-Production-Grade-Suite/security-engineer/findings/critical.md` |
| High findings | `Claude-Production-Grade-Suite/security-engineer/findings/high.md` |
| Medium findings | `Claude-Production-Grade-Suite/security-engineer/findings/medium.md` |
| Low findings | `Claude-Production-Grade-Suite/security-engineer/findings/low.md` |

All findings are framed as a **Wave B verification checklist** — "things the Backend/Frontend Engineer must implement correctly" — not confirmed vulnerabilities, except where existing scaffolding code (`0001_init.sql`, `docker-compose.yml`, `pagbank.ts`, `.env.example`) already demonstrates the gap directly, which are marked **[GROUNDED IN CODE]** below.
