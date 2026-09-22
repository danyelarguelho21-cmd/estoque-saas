// Fixtures for PagBank webhook payloads (ADR-004 PaymentWebhookEvent normalization target) and
// for the raw (pre-normalization) payload shape the /api/webhooks/pagbank route receives.
//
// FIXED (Wave B, real-implementation verification): the original shape here (`{event_id,
// charge_id, status, paid_at}`) was a generic guess written before the real PagBank integration
// existed. The real implementation (libs/shared/src/payments/providers/pagbank.ts
// `parseWebhookEvent`, verified by reading the actual code against the cited PagBank API docs)
// expects the PagBank Orders webhook shape instead — the payload IS the Order, with
// `charges[].status` (PAID/DECLINED/CANCELED) and a top-level `id` used as the idempotency key
// (`gatewayEventId`) when present. Using the old shape made every webhook call fail with
// "formato de evento não reconhecido" before signature verification even mattered — a genuine
// test/contract-drift bug in this fixture, not an application bug.
import { createHash } from "node:crypto";

export interface RawPagbankChargeEventPayload {
  id: string;
  reference_id?: string;
  charges: Array<{ id: string; status: "PAID" | "DECLINED" | "CANCELED" }>;
  [key: string]: unknown;
}

export function makeRawChargePaidPayload(
  overrides: Partial<{ eventId: string; chargeId: string }> = {},
): RawPagbankChargeEventPayload {
  const eventId = overrides.eventId ?? `evt_${Math.random().toString(36).slice(2, 10)}`;
  const chargeId = overrides.chargeId ?? `chg_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: eventId,
    reference_id: `order-${eventId}`,
    charges: [{ id: chargeId, status: "PAID" }],
  };
}

export function makeRawChargeDeclinedPayload(
  overrides: Partial<{ eventId: string; chargeId: string }> = {},
): RawPagbankChargeEventPayload {
  const eventId = overrides.eventId ?? `evt_${Math.random().toString(36).slice(2, 10)}`;
  const chargeId = overrides.chargeId ?? `chg_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: eventId,
    reference_id: `order-${eventId}`,
    charges: [{ id: chargeId, status: "DECLINED" }],
  };
}

/**
 * Real PagBank webhook authenticity signature (libs/shared/src/payments/providers/pagbank.ts
 * `PagBankProvider.verifyWebhookSignature`, sent as header `x-authenticity-token` — NOT
 * `x-pagbank-signature`, which does not exist in the real route):
 * `sha256(`${webhookSecret}-${rawBody}`)` hex digest, checked byte-for-byte against the RAW
 * request body string (never a re-`JSON.stringify`'d/reparsed object). Callers must compute this
 * from the EXACT same string that will be sent as the request body (see
 * tests/integration/webhook-idempotency.test.ts for the pattern: stringify once, sign that
 * string, then hand the same object to ApiClient.post() so its internal JSON.stringify produces
 * an identical byte string).
 */
export function makeAuthenticityToken(rawBody: string, secret: string): string {
  return createHash("sha256").update(`${secret}-${rawBody}`).digest("hex");
}
