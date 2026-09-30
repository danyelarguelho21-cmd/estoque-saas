import { timingSafeEqual } from "node:crypto";
import type {
  OneOffChargeInput,
  OneOffChargeResult,
  PaymentProvider,
  PaymentWebhookEvent,
  PixSubscriptionInput,
  RecurringChargeInput,
  RecurringChargeResult,
} from "../provider";

type VindiConfig = { apiKey: string; webhookSecret: string; baseUrl?: string };
type VindiBill = {
  id?: number;
  status?: string;
  due_at?: string;
  url?: string;
  created_at?: string;
  charges?: Array<{ last_transaction?: { gateway_response_fields?: { qrcode_original_path?: string } } }>;
};

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
    const customerId = await this.getOrCreateCustomer(input.tenantId, input.customerName, input.customerEmail, input.customerTaxId);
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
    const customerId = await this.getOrCreateCustomer(input.tenantId, input.customerName, input.customerEmail, input.customerTaxId);
    const result = await this.createSubscription(input.gatewayPlanId, customerId, "pix", undefined, input.tenantId);
    await this.assertInitialCharge(result);
    return { ...result, gatewayCustomerId: String(customerId) };
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
    const root = payload as { id?: unknown; event?: { type?: unknown; created_at?: unknown; data?: { bill?: VindiBill & { amount?: string; payment_method?: { code?: string }; subscription?: { id?: number } }; charge?: { id?: number; bill?: { id?: number }; status?: string }; subscription?: { id?: number; status?: string } } } };
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
        amountCents: Math.round(Number(bill.amount ?? 0) * 100),
        dueDate: bill.due_at ?? bill.created_at ?? new Date().toISOString(),
        paymentMethod: method,
      };
      if (bill.url) created.paymentUrl = bill.url;
      const qr = bill.charges?.[0]?.last_transaction?.gateway_response_fields?.qrcode_original_path;
      if (qr) created.pixQrCode = qr;
      return created;
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

  private async getOrCreateCustomer(tenantId: string, name: string, email: string, registryCode: string): Promise<number> {
    const query = new URLSearchParams({ query: `code=${tenantId}`, per_page: "1" });
    const existing = await this.request<Array<{ id: number }>>(`/customers?${query}`, "GET");
    if (existing[0]?.id) return existing[0].id;
    const response = await this.request<{ customer?: { id?: number }; id?: number }>("/customers", "POST", {
      name,
      email,
      registry_code: registryCode.replace(/\D/g, ""),
      code: tenantId,
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
      const charge: OneOffChargeResult & { dueDate?: string } = { gatewayChargeId: String(bill.id) };
      if (bill.url) charge.boletoUrl = bill.url;
      const qr = bill.charges?.[0]?.last_transaction?.gateway_response_fields?.qrcode_original_path;
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

  private async request<T>(path: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<T> {
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
