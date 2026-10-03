import { timingSafeEqual } from "node:crypto";
import type {
  BillingAddress,
  OneOffChargeInput,
  OneOffChargeResult,
  PaymentProvider,
  PaymentWebhookEvent,
  PixSubscriptionInput,
  RecurringChargeInput,
  RecurringChargeResult,
} from "../provider";

// pixQrPollDelayMs: intervalo entre as consultas de QR Code (waitForPixQrCode); testes usam 0.
type VindiConfig = { apiKey: string; webhookSecret: string; baseUrl?: string; pixQrPollDelayMs?: number };
type VindiCharge = { id?: number; status?: string; bill?: { id?: number; url?: string }; last_transaction?: { gateway_response_fields?: { qrcode_original_path?: string } } };
type VindiBill = {
  id?: number;
  amount?: string | number;
  status?: string;
  due_at?: string;
  url?: string;
  created_at?: string;
  charges?: VindiCharge[];
};
type CustomerInput = { tenantId: string; name: string; email: string; registryCode: string; address?: BillingAddress | undefined };

// bill.amount vem em reais ("149.9" ou 149.9). undefined se ausente/inválido — quem consome cai
// no preço do plano local, nunca em R$ 0,00.
function billAmountCents(amount: string | number | undefined): number | undefined {
  if (amount === undefined || amount === null || amount === "") return undefined;
  const value = Number(amount);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : undefined;
}

// O copia-e-cola Pix vem em charges[].last_transaction.gateway_response_fields.qrcode_original_path.
// Lê da cobrança mais recente que tiver o código (uma fatura pode ter tentativas anteriores
// recusadas — ex.: a recusa por falta de endereço — antes da que gerou o QR).
function pixQrFromCharges(charges: VindiCharge[] | undefined): string | undefined {
  for (const charge of [...(charges ?? [])].reverse()) {
    const qr = charge.last_transaction?.gateway_response_fields?.qrcode_original_path;
    if (qr) return qr;
  }
  return undefined;
}

function toVindiAddress(address: BillingAddress): Record<string, string> {
  return {
    street: address.street,
    number: address.number,
    ...(address.complement ? { additional_details: address.complement } : {}),
    zipcode: address.zipcode.replace(/\D/g, ""),
    ...(address.neighborhood ? { neighborhood: address.neighborhood } : {}),
    city: address.city,
    state: address.state.toUpperCase(),
    country: "BR",
  };
}

const timeoutMs = 12_000;

export class VindiProvider implements PaymentProvider {
  private readonly baseUrl: string;

  constructor(private readonly config: VindiConfig) {
    this.baseUrl = (config.baseUrl ?? "https://sandbox-app.vindi.com.br/api/v1").replace(/\/$/, "");
    if (!config.apiKey) throw new Error("VindiProvider: configure VINDI_API_KEY.");
    if (!config.webhookSecret) throw new Error("VindiProvider: configure VINDI_WEBHOOK_SECRET.");
    const apiUrl = new URL(this.baseUrl);
    if (apiUrl.protocol !== "https:" || !["app.vindi.com.br", "sandbox-app.vindi.com.br"].includes(apiUrl.hostname) || apiUrl.pathname !== "/api/v1") {
      throw new Error("Vindi API base deve ser a URL HTTPS oficial /api/v1 da Vindi.");
    }
  }

  async createRecurringCardCharge(input: RecurringChargeInput): Promise<RecurringChargeResult> {
    if (!input.gatewayPlanId || !input.customerName || !input.customerTaxId) {
      throw new Error("Vindi exige ID de plano, nome e CPF/CNPJ para criar a assinatura.");
    }
    const customerId = await this.getOrCreateCustomer({ tenantId: input.tenantId, name: input.customerName, email: input.customerEmail, registryCode: input.customerTaxId, address: input.billingAddress });
    const profile = await this.request<{ gateway_token?: string }>("/payment_profiles", "POST", {
      gateway_token: input.cardToken,
      customer_id: customerId,
      payment_method_code: "credit_card",
    });
    if (!profile.gateway_token) throw new Error("Vindi não confirmou o perfil de pagamento do cartão.");
    const result = await this.createSubscription(input.gatewayPlanId, customerId, "credit_card", profile.gateway_token, input.tenantId);
    await this.assertInitialCharge(result);
    return { ...result, gatewayCustomerId: String(customerId) };
  }

  async createRecurringPixCharge(input: PixSubscriptionInput): Promise<RecurringChargeResult> {
    // Sem endereço o gateway "Vindi Pagamentos" recusa a transação Pix; a assinatura e a fatura
    // seriam criadas mesmo assim, só que sem QR Code. Falha antes de criar qualquer coisa na Vindi.
    if (!input.billingAddress) {
      throw new Error("A Vindi exige o endereço de cobrança do cliente para gerar o Pix.");
    }
    const customerId = await this.getOrCreateCustomer({ tenantId: input.tenantId, name: input.customerName, email: input.customerEmail, registryCode: input.customerTaxId, address: input.billingAddress });
    const result = await this.createSubscription(input.gatewayPlanId, customerId, "pix", undefined, input.tenantId);
    await this.waitForPixQrCode(result);
    await this.assertInitialCharge(result);
    return { ...result, gatewayCustomerId: String(customerId) };
  }

  // A Vindi costuma criar a transação Pix de forma assíncrona: a resposta do POST /subscriptions
  // traz a fatura (bill.url) mas ainda sem o QR Code. Consulta a fatura algumas vezes até o
  // gateway devolver o código copia-e-cola, para o QR aparecer direto na tela de assinatura.
  // Se não vier a tempo, o webhook charge_created/charge_updated completa a fatura depois.
  // Pior caso ~7,5s de espera + as requisições: por isso subscriptions.ts chama o provider FORA
  // da transação do banco (o timeout padrão de transação interativa do Prisma é 5s).
  private async waitForPixQrCode(result: RecurringChargeResult, attempts = 5, delayMs = this.config.pixQrPollDelayMs ?? 1_500): Promise<void> {
    const charge = result.initialCharge;
    if (!charge?.gatewayChargeId || charge.pixQrCode || result.initialChargeStatus !== "pending") return;
    for (let i = 0; i < attempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const response = await this.request<{ bill?: VindiBill }>(`/bills/${encodeURIComponent(charge.gatewayChargeId)}`, "GET");
        const qr = pixQrFromCharges(response.bill?.charges);
        if (response.bill?.url && !charge.boletoUrl) charge.boletoUrl = response.bill.url;
        if (qr) { charge.pixQrCode = qr; return; }
      } catch (error) {
        console.error("[vindi] falha ao consultar QR Code Pix da fatura:", error instanceof Error ? error.message : error);
      }
    }
    console.warn(`[vindi] fatura ${charge.gatewayChargeId} criada sem QR Code Pix após ${attempts} tentativas; usando apenas o link da fatura.`);
  }

  private async assertInitialCharge(result: RecurringChargeResult): Promise<void> {
    const charge = result.initialCharge;
    if (charge?.gatewayChargeId && (charge.pixQrCode || charge.boletoUrl) && result.initialChargeStatus !== "failed") return;
    try { await this.cancelSubscription(result.gatewaySubscriptionId); } catch (error) {
      console.error("[vindi] falha ao cancelar assinatura sem cobrança inicial confirmável:", error instanceof Error ? error.message : error);
    }
    throw new Error("A Vindi não gerou a cobrança inicial. Habilite a cobrança imediata no plano e confirme o método de pagamento no Sandbox.");
  }

  async createOneOffCharge(_input: OneOffChargeInput): Promise<OneOffChargeResult> {
    throw new Error("Vindi gera cobranças recorrentes pela assinatura; cobrança avulsa não configurada.");
  }

  async fetchPixQrCodeImage(_imageUrl: string): Promise<Uint8Array> {
    throw new Error("A Vindi entrega o pagamento Pix pelo link da fatura.");
  }

  async cancelSubscription(gatewaySubscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${encodeURIComponent(gatewaySubscriptionId)}?cancel_bills=true`, "DELETE");
  }

  verifyWebhookSignature(_payload: string, signature: string): boolean {
    const expected = Buffer.from(this.config.webhookSecret);
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  parseWebhookEvent(payload: unknown): PaymentWebhookEvent {
    const root = payload as { id?: unknown; event?: { type?: unknown; created_at?: unknown; data?: { bill?: VindiBill & { payment_method?: { code?: string }; subscription?: { id?: number } }; charge?: VindiCharge; subscription?: { id?: number; status?: string } } } };
    const event = root.event;
    const type = String(event?.type ?? "");
    const bill = event?.data?.bill;
    const subscriptionId = event?.data?.subscription?.id ?? bill?.subscription?.id;
    const charge = event?.data?.charge;
    const billId = bill?.id ?? charge?.bill?.id;
    const eventId = `${type}-${String(root.id ?? billId ?? charge?.id ?? subscriptionId ?? "unknown")}-${String(event?.created_at ?? "")}`;

    if (type === "bill_created" && bill?.id != null && subscriptionId != null) {
      const methodCode = bill.payment_method?.code;
      const method = methodCode === "credit_card" ? "card" : methodCode === "bank_slip" ? "boleto" : "pix";
      const created: Extract<PaymentWebhookEvent, { type: "charge.created" }> = {
        type: "charge.created",
        gatewayEventId: eventId,
        gatewayChargeId: String(bill.id),
        gatewaySubscriptionId: String(subscriptionId),
        dueDate: bill.due_at ?? bill.created_at ?? new Date().toISOString(),
        paymentMethod: method,
      };
      const amountCents = billAmountCents(bill.amount);
      if (amountCents !== undefined) created.amountCents = amountCents;
      if (bill.url) created.paymentUrl = bill.url;
      const qr = pixQrFromCharges(bill.charges);
      if (qr) created.pixQrCode = qr;
      return created;
    }

    // A transação Pix pode ser concluída depois do bill_created (ainda sem QR). O identificador
    // local da fatura (invoice.gatewayChargeId) é o id da bill, não o da charge.
    if ((type === "charge_created" || type === "charge_updated") && charge?.bill?.id != null) {
      const qr = pixQrFromCharges([charge]);
      if (!qr) return { type: "ignored", gatewayEventId: eventId };
      const updated: Extract<PaymentWebhookEvent, { type: "charge.pix_updated" }> = {
        type: "charge.pix_updated",
        gatewayEventId: eventId,
        gatewayChargeId: String(charge.bill.id),
        pixQrCode: qr,
      };
      if (charge.bill.url) updated.paymentUrl = charge.bill.url;
      return updated;
    }

    if (type === "bill_paid" && bill?.id != null) {
      return { type: "charge.paid", gatewayEventId: eventId, gatewayChargeId: String(bill.id), paidAt: String(event?.created_at ?? new Date().toISOString()) };
    }
    if (["bill_rejected", "bill_canceled", "bill_expired", "charge_rejected", "charge_canceled"].includes(type) && billId != null) {
      return { type: "charge.failed", gatewayEventId: eventId, gatewayChargeId: String(billId), reason: type };
    }
    if (type === "subscription_canceled" && subscriptionId != null) {
      return { type: "subscription.canceled", gatewayEventId: eventId, gatewaySubscriptionId: String(subscriptionId) };
    }
    return { type: "ignored", gatewayEventId: eventId };
  }

  private async getOrCreateCustomer(input: CustomerInput): Promise<number> {
    const query = new URLSearchParams({ query: `code=${input.tenantId}`, per_page: "1" });
    // GET /customers responde { customers: [...] } (o código antigo lia como array puro, nunca
    // achava o cliente e criava um novo a cada tentativa). Confere o `code` devolvido: se a busca
    // fosse ignorada, o primeiro cliente da conta (de outro tenant) seria atualizado e cobrado.
    const existing = await this.request<{ customers?: Array<{ id?: number; code?: string | null }> } | Array<{ id?: number; code?: string | null }>>(`/customers?${query}`, "GET");
    const existingId = (Array.isArray(existing) ? existing : existing.customers ?? []).find((customer) => customer.code === input.tenantId)?.id;
    if (existingId) {
      // Cliente criado antes de o Zolo coletar endereço (ou com endereço antigo): atualiza antes
      // de criar a assinatura, senão o gateway Pix recusa a transação da nova fatura.
      if (input.address) {
        await this.request(`/customers/${encodeURIComponent(String(existingId))}`, "PUT", { address: toVindiAddress(input.address) });
      }
      return existingId;
    }
    const response = await this.request<{ customer?: { id?: number }; id?: number }>("/customers", "POST", {
      name: input.name,
      email: input.email,
      registry_code: input.registryCode.replace(/\D/g, ""),
      code: input.tenantId,
      ...(input.address ? { address: toVindiAddress(input.address) } : {}),
    });
    const id = response.customer?.id ?? response.id;
    if (!id) throw new Error("Vindi não retornou o ID do cliente cadastrado.");
    return id;
  }

  private async createSubscription(planId: string, customerId: number, method: string, gatewayToken: string | undefined, tenantId: string): Promise<RecurringChargeResult> {
    const body: Record<string, unknown> = {
      plan_id: Number(planId),
      customer_id: customerId,
      payment_method_code: method,
      code: tenantId,
      ...(gatewayToken ? { payment_profile: { gateway_token: gatewayToken, payment_method_code: method } } : {}),
    };
    const response = await this.request<{ subscription?: { id?: number; status?: string }; bill?: VindiBill }>("/subscriptions", "POST", body);
    const subscription = response.subscription;
    if (!subscription?.id) throw new Error("Vindi não retornou a assinatura criada.");
    const status = subscription.status === "active" ? "active" : subscription.status === "pending" ? "pending" : "failed";
    const bill = response.bill;
    const result: RecurringChargeResult = {
      gatewaySubscriptionId: String(subscription.id),
      gatewayCustomerId: String(customerId),
      status,
    };
    if (bill?.id != null) {
      const charge: NonNullable<RecurringChargeResult["initialCharge"]> = { gatewayChargeId: String(bill.id) };
      const amountCents = billAmountCents(bill.amount);
      if (amountCents !== undefined) charge.amountCents = amountCents;
      if (bill.url) charge.boletoUrl = bill.url;
      const qr = pixQrFromCharges(bill.charges);
      if (qr) charge.pixQrCode = qr;
      if (bill.due_at) charge.dueDate = bill.due_at;
      result.initialCharge = charge;
      result.initialChargeStatus = bill.status === "paid" ? "paid" : bill.status === "pending" ? "pending" : "failed";
      if (result.initialChargeStatus === "paid") result.status = "active";
      else if (result.initialChargeStatus === "pending") result.status = "pending";
      else if (result.initialChargeStatus === "failed") result.status = "failed";
    } else {
      // Sem fatura de ciclo inicial não há pagamento comprovado e, portanto, não liberar acesso.
      result.status = "pending";
    }
    return result;
  }

  private async request<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.config.apiKey}:`).toString("base64");
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed: unknown = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { message: "Resposta inválida da Vindi." }; }
    if (!response.ok) {
      const error = new Error(`Vindi respondeu HTTP ${response.status}.`) as Error & { status: number; body: unknown };
      error.status = response.status;
      error.body = parsed;
      throw error;
    }
    return parsed as T;
  }
}
