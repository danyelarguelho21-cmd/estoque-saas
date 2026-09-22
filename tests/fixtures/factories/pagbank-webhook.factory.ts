// Fixtures for PagBank webhook payloads (ADR-004 PaymentWebhookEvent normalization target) and
// for the raw (pre-normalization) payload shape the /api/webhooks/pagbank route receives.

export interface RawPagbankChargePaidPayload {
  event_id: string;
  charge_id: string;
  status: "PAID";
  paid_at: string;
  [key: string]: unknown;
}

export function makeRawChargePaidPayload(
  overrides: Partial<RawPagbankChargePaidPayload> = {},
): RawPagbankChargePaidPayload {
  return {
    event_id: overrides.event_id ?? `evt_${Math.random().toString(36).slice(2, 10)}`,
    charge_id: overrides.charge_id ?? `chg_${Math.random().toString(36).slice(2, 10)}`,
    status: "PAID",
    paid_at: overrides.paid_at ?? new Date().toISOString(),
    ...overrides,
  };
}

/** A syntactically valid but signature-mismatched payload, for the 401-rejection test. */
export function makeSignatureFor(payload: unknown, secret: string): string {
  // Placeholder HMAC-shaped signature — the real PagbankProvider.verifyWebhookSignature is
  // implementation-owned (ADR-004); this fixture exists so the *invalid* signature test
  // ("garbage-signature") has an intentionally-wrong counterpart to compare against a
  // deliberately-broken one in the "reject unverifiable signature" test case.
  return `sha256=${Buffer.from(`${secret}:${JSON.stringify(payload)}`).toString("hex").slice(0, 64)}`;
}
