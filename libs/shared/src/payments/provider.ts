// Interface de gateway de pagamento — ver ADR-004.
// O domínio de billing (services/app/src/modules/billing) depende SOMENTE desta interface,
// nunca do SDK do PagBank diretamente.

// Endereço de cobrança do tenant (Tenant.billing*). O gateway Pix da Vindi recusa a transação de
// cliente sem endereço ("Logradouro não pode ficar em branco, Cep não possui o tamanho esperado...").
export interface BillingAddress {
  zipcode: string; // 8 dígitos, sem máscara
  street: string;
  number: string;
  complement?: string | null | undefined;
  neighborhood?: string | null | undefined;
  city: string;
  state: string; // UF, 2 letras
}

export type TenantAddressColumns = {
  billingZipcode: string | null;
  billingStreet: string | null;
  billingNumber: string | null;
  billingComplement: string | null;
  billingNeighborhood: string | null;
  billingCity: string | null;
  billingState: string | null;
};

// Endereço completo o bastante para o gateway Pix (CEP, rua, número, cidade, UF) ou null —
// tenants criados antes da coleta de endereço têm todas essas colunas NULL.
export function tenantBillingAddress(tenant: TenantAddressColumns): BillingAddress | null {
  const { billingZipcode, billingStreet, billingNumber, billingCity, billingState } = tenant;
  if (!billingZipcode || !billingStreet || !billingNumber || !billingCity || !billingState) return null;
  return {
    zipcode: billingZipcode,
    street: billingStreet,
    number: billingNumber,
    complement: tenant.billingComplement,
    neighborhood: tenant.billingNeighborhood,
    city: billingCity,
    state: billingState,
  };
}

export interface RecurringChargeInput {
  tenantId: string;
  planId: string;
  gatewayPlanId?: string;
  cardToken: string;
  customerEmail: string;
  customerName?: string;
  customerTaxId?: string;
  billingAddress?: BillingAddress;
}

export interface RecurringChargeResult {
  gatewaySubscriptionId: string;
  gatewayCustomerId: string;
  status: "active" | "pending" | "failed";
  // amountCents: valor que o gateway efetivamente cobrou na fatura (Vindi: bill.amount) — é o que
  // vai para a fatura local, não plan.priceCents. Ausente se o gateway não informou.
  initialCharge?: OneOffChargeResult & { dueDate?: string; amountCents?: number };
  initialChargeStatus?: "paid" | "pending" | "failed";
}

export interface PixSubscriptionInput {
  tenantId: string;
  planId: string;
  gatewayPlanId: string;
  customerEmail: string;
  customerName: string;
  customerTaxId: string;
  billingAddress?: BillingAddress;
}

export interface OneOffChargeInput {
  tenantId: string;
  idempotencyKey: string;
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
  billingAddress?: BillingAddress;
}

export interface OneOffChargeResult {
  gatewayChargeId: string;
  pixQrCode?: string;
  pixQrCodeImageUrl?: string;
  boletoUrl?: string;
}

export type PaymentWebhookEvent =
  | { type: "ignored"; gatewayEventId: string }
  | { type: "charge.created"; gatewayEventId: string; gatewayChargeId: string; gatewaySubscriptionId: string; amountCents?: number; dueDate: string; paymentMethod: "card" | "pix" | "boleto"; paymentUrl?: string; pixQrCode?: string }
  // QR Code Pix que chegou depois da fatura (Vindi: charge_created/charge_updated) — só atualiza
  // o copia-e-cola da fatura já existente, sem mudar status.
  | { type: "charge.pix_updated"; gatewayEventId: string; gatewayChargeId: string; pixQrCode: string; paymentUrl?: string }
  | { type: "charge.paid"; gatewayEventId: string; gatewayChargeId: string; paidAt: string }
  | { type: "charge.failed"; gatewayEventId: string; gatewayChargeId: string; reason: string }
  | { type: "subscription.canceled"; gatewayEventId: string; gatewaySubscriptionId: string };

export interface PaymentProvider {
  createRecurringCardCharge(input: RecurringChargeInput): Promise<RecurringChargeResult>;
  createRecurringPixCharge?(input: PixSubscriptionInput): Promise<RecurringChargeResult>;
  createOneOffCharge(input: OneOffChargeInput): Promise<OneOffChargeResult>;
  fetchPixQrCodeImage(imageUrl: string): Promise<Uint8Array>;
  cancelSubscription(gatewaySubscriptionId: string): Promise<void>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
  parseWebhookEvent(payload: unknown): PaymentWebhookEvent;
}
