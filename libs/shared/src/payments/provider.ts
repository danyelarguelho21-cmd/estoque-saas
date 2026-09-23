// Interface de gateway de pagamento — ver ADR-004.
// O domínio de billing (services/app/src/modules/billing) depende SOMENTE desta interface,
// nunca do SDK do PagBank diretamente.

export interface RecurringChargeInput {
  tenantId: string;
  planId: string;
  cardToken: string;
  customerEmail: string;
}

export interface RecurringChargeResult {
  gatewaySubscriptionId: string;
  gatewayCustomerId: string;
  status: "active" | "pending" | "failed";
}

export interface OneOffChargeInput {
  tenantId: string;
  amountCents: number;
  dueDate: string; // ISO date
  method: "pix" | "boleto";
  customerEmail: string;
  // BUG FIX (found live: every real pix/boleto charge attempt got a real 400 from PagBank —
  // "customer.tax_id must be a valid CPF or CNPJ" / "customer.name must not contain [@...]" —
  // the provider used to hardcode tax_id="" and pass the EMAIL as the name field). PagBank's
  // Orders API requires both on `customer`; the tenant's own name/cnpj (collected at signup,
  // Tenant.name/Tenant.cnpj) are what these must actually be.
  customerName: string;
  customerTaxId: string; // CPF/CNPJ, any formatting — the provider strips non-digits itself
}

export interface OneOffChargeResult {
  gatewayChargeId: string;
  pixQrCode?: string;
  boletoUrl?: string;
}

export type PaymentWebhookEvent =
  | { type: "charge.paid"; gatewayEventId: string; gatewayChargeId: string; paidAt: string }
  | { type: "charge.failed"; gatewayEventId: string; gatewayChargeId: string; reason: string }
  | { type: "subscription.canceled"; gatewayEventId: string; gatewaySubscriptionId: string };

export interface PaymentProvider {
  createRecurringCardCharge(input: RecurringChargeInput): Promise<RecurringChargeResult>;
  createOneOffCharge(input: OneOffChargeInput): Promise<OneOffChargeResult>;
  cancelSubscription(gatewaySubscriptionId: string): Promise<void>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
  parseWebhookEvent(payload: unknown): PaymentWebhookEvent;
}
