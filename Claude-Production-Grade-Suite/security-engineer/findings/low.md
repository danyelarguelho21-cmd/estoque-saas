# Low Findings — Wave B CODE-LEVEL Audit (estoque-saas)

Supersedes the Wave A version of this file (preserved in git history). SLA per severity standard:
fix within 1 quarter. Not auto-fixed per task scope.

---

## Wave A lows — verification result

| ID | Wave A finding | Wave B status |
|----|----------------|----------------|
| L-1 | Weak default `POSTGRES_PASSWORD` fallback in docker-compose | **Still open, unchanged.** `docker-compose.yml` still has `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-devpassword}` and the equivalent silent defaults now also exist for `APP_DB_PASSWORD`/`PLATFORM_ADMIN_DB_PASSWORD` (`:-devpassword-app-user`, `:-devpassword-platform-admin`). Acceptable for local dev; a production deploy tool must assert these are explicitly set (DevOps/SHIP-phase concern). |
| L-2 | Placeholder secrets need boot-time validation in non-dev environments | **Partially improved, not fully closed.** `AUTH_SECRET` and `PAGBANK_WEBHOOK_SECRET` now fail fast on **first use** (`authorize()` throws; `PagBankProvider` constructor throws) rather than silently degrading — this is better than Wave A's "blank secret" baseline and was a real bug fix in this repo's own history (commit `333cf7e`, moving the check out of module scope so it doesn't break `next build`). However there is still no single *boot-time* (process-start) assertion that fails the container immediately if these are blank in a non-dev environment — the failure only surfaces on the first real login attempt / first webhook, which is better than fail-open but not as strong as fail-to-boot. Recommend DevOps add an entrypoint pre-flight check. |
| L-3 | No platform-level audit trail for `platform_admin` suspend/reactivate actions | **Still open, unchanged.** `modules/admin/tenants.ts::suspendTenant`/`reactivateTenant` still perform a plain `platformAdminPrisma.tenant.update()` with no accompanying audit record. Recommended control unchanged from Wave A (a global, RLS-disabled `platform_audit_log` table). |
| L-4 | Cross-tenant barcode/EAN matching — informational, assessed adequate | **Reconfirmed adequate.** `modules/stock/nfe-import.ts` matching logic runs inside `withTenant()`-scoped queries only; no cross-tenant matching path found. |
| L-5 | No protection against demoting/disabling the last remaining tenant admin | **Still open, unchanged.** `modules/auth/users.ts::updateUserRole` performs the role change unconditionally once RBAC (`requireRole("users:manage")`) passes — no check for "would this leave the tenant with zero active admins." Operational-lockout risk, not a classic vulnerability; unchanged from Wave A. |

---

## NEW — L-6: login timing side-channel allows coarse user-enumeration by response latency

**STRIDE:** Information Disclosure (minor)
**Evidence:** `services/app/src/modules/auth/login.ts::verifyLoginCredentials` — when
`auth_lookup_user_by_email()` returns zero rows (no account with that email in any tenant), the
function returns `null` immediately without ever calling `bcrypt.compare()`. When the email *does*
exist, at least one `bcrypt.compare()` call runs (cost factor 12, deliberately slow — tens of
milliseconds). An attacker measuring response latency can distinguish "email exists" from "email
does not exist" with reasonable statistical confidence over repeated samples, independent of the
password guessed.
**Why it's Low, not Medium:** this is a coarse, noisy signal (network jitter, server load) that
requires many samples per candidate email to be reliable, and the account-enumeration value is
limited in a B2B inventory-SaaS context (tenant admin emails are typically business emails, not a
sensitive population). The rate limiting added for H-5 this session (6 attempts per email per 15
minutes, 20 per IP per 5 minutes) now also meaningfully throttles the sample volume available to
an attacker attempting this timing attack, which further reduces practical exploitability versus
when this residual was first noticed.
**Recommended control:** always perform a dummy `bcrypt.compare()` against a fixed, pre-computed
hash when no matching row is found, so the function's latency profile is uniform regardless of
whether the email exists. Not auto-fixed this session (Low severity, out of the
Critical/High auto-fix scope per task instructions) — straightforward one-function change for the
next HARDEN/remediation pass; noting the exact fix shape here so it doesn't need re-discovery:

```ts
// in verifyLoginCredentials, after `const rows = await platformPrisma.$queryRaw<...>...`
if (rows.length === 0) {
  await verifyPassword(plainPassword, DUMMY_BCRYPT_HASH); // constant-shape timing, result discarded
  return null;
}
```
