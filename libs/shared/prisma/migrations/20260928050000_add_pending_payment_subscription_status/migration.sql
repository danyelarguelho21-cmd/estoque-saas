/*
  BUG FIX (2026-09-28, found live in production via manual test): a freshly signed-up tenant got
  full product access with zero payment confirmed — subscriptions were born "trialing"/"active"
  and no guard checked payment state (see modules/auth/rbac.ts's requireSession/requireRole).
  This product has no trial period (BRD: pagar pra usar). "pending_payment" is the real initial
  status now; "trialing" stays a valid value only for rows already in this state before the fix —
  no code creates it anymore.

  Warnings:

  - Adds (or replaces) the CHECK constraint `subscriptions_status_check` to also allow
    'pending_payment'. Existing rows are unaffected (their current values — 'trialing'/'active' —
    remain valid under the new constraint either way).

  NOTE: confirmed directly against production (`pg_constraint`) that no such constraint exists
  there today — production's schema comes from this Prisma migration chain, never from
  schemas/migrations/0001_init.sql (that raw-SQL file is only used to build the test database from
  scratch, where the constraint DOES already exist and is updated there too, in the same commit).
  `DROP CONSTRAINT IF EXISTS` makes this migration safe to apply in both cases.
*/
-- AlterTable
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_status_check";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check" CHECK (status IN ('pending_payment','trialing','active','past_due','canceled'));
