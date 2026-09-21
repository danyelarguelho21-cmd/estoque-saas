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
