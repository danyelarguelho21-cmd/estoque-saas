import { createHash, timingSafeEqual } from "node:crypto";
import type {
  OneOffChargeInput,
  OneOffChargeResult,
  PaymentProvider,
  PaymentWebhookEvent,
  RecurringChargeInput,
  RecurringChargeResult,
} from "../provider";

// Implementação concreta do PaymentProvider para PagBank/PagSeguro (ADR-004).
//
// Fontes (verificadas via WebSearch/WebFetch em developer.pagbank.com.br, set/2026):
// - Assinaturas (cartão recorrente): https://developer.pagbank.com.br/reference/criar-assinatura
//   POST {subscriptionsBaseUrl}/subscriptions — Authorization: Bearer <token>
// - Cancelamento: https://developer.pagbank.com.br/reference/cancelar-assinatura
//   PUT {subscriptionsBaseUrl}/subscriptions/{id}/cancel
// - Pedidos (Pix/boleto avulso): https://developer.pagbank.com.br/reference/criar-pedido-simples
//   e https://developer.pagbank.com.br/reference/criar-pagar-pedido-com-boleto
//   POST {ordersBaseUrl}/orders — corpo com `charges[0].payment_method` (BOLETO) ou
//   `qr_codes[0]` (Pix) — ver README de cada método abaixo.
// - Webhooks de pedido/cobrança: https://developer.pagbank.com.br/reference/webhooks
//   payload = o próprio Order, com `charges[].status` (PAID/DECLINED/CANCELED/WAITING).
// - Webhooks de assinatura: https://developer.pagbank.com.br/reference/webhooks-assinaturas
//   payload = `{ event: "subscription.canceled", resource: { id: "SUBS_..." } }`.
// - Assinatura de autenticidade do webhook: https://developer.pagbank.com.br/reference/confirmar-autenticidade-da-notificacao
//   header `x-authenticity-token` = sha256(`${accountToken}-${rawPayload}`), payload SEM reformatação.
//
// LIMITAÇÃO CONHECIDA: o mapeamento exato do `cardToken` (tokenizado client-side via PagBank.js)
// para o campo de cartão da API de Assinaturas não pôde ser confirmado byte-a-byte na documentação
// pública disponível no momento da implementação (a doc mostra o fluxo de cartão "cru" para cliente
// novo, e card.security_code para referência a um cartão já salvo por id). Assumimos aqui que o token
// do client-side é enviado como `card.token` (mesma convenção usada pelo restante do ecossistema de
// APIs de cartão do PagBank/PagSeguro para referenciar um cartão previamente tokenizado). Esta
// suposição está marcada explicitamente e deve ser validada contra o ambiente sandbox real na fase
// HARDEN/QA antes de produção (nenhum teste de integração real pôde rodar aqui — sem credenciais/rede
// de sandbox neste ambiente).

interface PagBankConfig {
  apiKey: string;
  baseUrl: string; // base da API de Pedidos (Orders), ex: https://sandbox.api.pagseguro.com
  webhookSecret: string; // account token usado na assinatura de autenticidade do webhook
  subscriptionsBaseUrl?: string; // base da API de Assinaturas; default derivado de baseUrl
}

function defaultSubscriptionsBaseUrl(ordersBaseUrl: string): string {
  return ordersBaseUrl.includes("sandbox")
    ? "https://sandbox.api.assinaturas.pagseguro.com"
    : "https://api.assinaturas.pagseguro.com";
}

interface PagBankApiError extends Error {
  status: number;
  body: unknown;
}

// code-reviewer finding HI-3: no timeout meant a hung PagBank API could block a request
// indefinitely — and generate-monthly-charge (billing/monthly-charge.ts) loops over EVERY active
// tenant sequentially, so one hung call there stalls billing for every tenant queued behind it.
// 10s is generous for a JSON API call (PagBank has no documented SLA longer than that) while still
// bounding the worst case; tune against a stated NFR latency budget if one exists.
const PAGBANK_REQUEST_TIMEOUT_MS = 10_000;

export class PagBankTimeoutError extends Error {
  constructor(url: string) {
    super(`PagBank API não respondeu em ${PAGBANK_REQUEST_TIMEOUT_MS}ms para ${url}`);
    this.name = "PagBankTimeoutError";
  }
}

async function pagbankFetch(
  url: string,
  apiKey: string,
  init: { method: "GET" | "POST" | "PUT"; body?: unknown },
): Promise<unknown> {
  const requestInit: RequestInit = {
    method: init.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(PAGBANK_REQUEST_TIMEOUT_MS),
  };
  if (init.body !== undefined) {
    requestInit.body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(url, requestInit);
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new PagBankTimeoutError(url);
    }
    throw err;
  }
  const text = await res.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`PagBank API respondeu ${res.status} para ${url}`) as PagBankApiError;
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export class PagBankProvider implements PaymentProvider {
  constructor(private readonly config: PagBankConfig) {
    // Fail fast (C-4): sem apiKey/webhookSecret configurados, o provider não deve aceitar
    // cobranças nem webhooks silenciosamente — melhor derrubar o boot do que processar
    // eventos não assinados / chamadas de API sem autenticação.
    if (!config.apiKey) {
      throw new Error("PagBankProvider: apiKey ausente (configure PAGBANK_API_KEY).");
    }
    if (!config.webhookSecret) {
      throw new Error("PagBankProvider: webhookSecret ausente (configure PAGBANK_WEBHOOK_SECRET).");
    }
  }

  async createRecurringCardCharge(input: RecurringChargeInput): Promise<RecurringChargeResult> {
    const base = this.config.subscriptionsBaseUrl ?? defaultSubscriptionsBaseUrl(this.config.baseUrl);
    const body = {
      reference_id: `tenant-${input.tenantId}-${Date.now()}`,
      plan: { id: input.planId },
      customer: {
        reference_id: input.tenantId,
        email: input.customerEmail,
      },
      payment_method: [
        {
          type: "CREDIT_CARD",
          card: { token: input.cardToken },
        },
      ],
    };
    const json = await pagbankFetch(`${base}/subscriptions`, this.config.apiKey, { method: "POST", body });
    const parsed = json as {
      id: string;
      status: string;
      customer?: { id?: string };
    };
    return {
      gatewaySubscriptionId: parsed.id,
      gatewayCustomerId: parsed.customer?.id ?? "",
      status: mapSubscriptionStatus(parsed.status),
    };
  }

  async createOneOffCharge(input: OneOffChargeInput): Promise<OneOffChargeResult> {
    const base = this.config.baseUrl;
    if (input.method === "boleto") {
      const body = {
        reference_id: `tenant-${input.tenantId}-${Date.now()}`,
        customer: { name: input.customerEmail, email: input.customerEmail, tax_id: "" },
        items: [{ reference_id: "assinatura-mensal", name: "Assinatura estoque-saas", quantity: 1, unit_amount: input.amountCents }],
        charges: [
          {
            reference_id: `charge-${input.tenantId}-${Date.now()}`,
            description: "Assinatura estoque-saas",
            amount: { value: input.amountCents, currency: "BRL" },
            payment_method: {
              type: "BOLETO",
              boleto: { due_date: input.dueDate, days_until_expiration: "5" },
            },
          },
        ],
      };
      const json = await pagbankFetch(`${base}/orders`, this.config.apiKey, { method: "POST", body });
      const parsed = json as {
        charges: Array<{ id: string; payment_method: { boleto?: { formatted_barcode?: string } }; links?: Array<{ href: string; media: string }> }>;
      };
      const charge = parsed.charges[0];
      const pdfLink = charge?.links?.find((l) => l.media === "application/pdf");
      const result: OneOffChargeResult = { gatewayChargeId: charge?.id ?? "" };
      if (pdfLink?.href !== undefined) result.boletoUrl = pdfLink.href;
      return result;
    }

    // pix: gera QR code ao nível do pedido (Orders "qr_codes")
    const body = {
      reference_id: `tenant-${input.tenantId}-${Date.now()}`,
      customer: { name: input.customerEmail, email: input.customerEmail, tax_id: "" },
      items: [{ reference_id: "assinatura-mensal", name: "Assinatura estoque-saas", quantity: 1, unit_amount: input.amountCents }],
      qr_codes: [
        {
          amount: { value: input.amountCents },
          expiration_date: `${input.dueDate}T23:59:59-03:00`,
        },
      ],
    };
    const json = await pagbankFetch(`${base}/orders`, this.config.apiKey, { method: "POST", body });
    const parsed = json as {
      id: string;
      qr_codes?: Array<{ id: string; text?: string }>;
    };
    const qr = parsed.qr_codes?.[0];
    const result: OneOffChargeResult = { gatewayChargeId: parsed.id };
    if (qr?.text !== undefined) result.pixQrCode = qr.text;
    return result;
  }

  async cancelSubscription(gatewaySubscriptionId: string): Promise<void> {
    const base = this.config.subscriptionsBaseUrl ?? defaultSubscriptionsBaseUrl(this.config.baseUrl);
    await pagbankFetch(`${base}/subscriptions/${gatewaySubscriptionId}/cancel`, this.config.apiKey, { method: "PUT" });
  }

  // Header x-authenticity-token = sha256(`${accountToken}-${rawPayload}`) — payload SEM reformatação
  // (o corpo bruto da requisição, não um JSON.stringify de um objeto reparseado).
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const computed = createHash("sha256").update(`${this.config.webhookSecret}-${payload}`).digest("hex");
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseWebhookEvent(payload: unknown): PaymentWebhookEvent {
    const obj = payload as Record<string, unknown>;

    // Evento de assinatura: { event: "subscription.canceled", resource: { id } }
    if (typeof obj["event"] === "string") {
      const eventName = obj["event"];
      const resource = obj["resource"] as { id?: string } | undefined;
      if (eventName === "subscription.canceled") {
        return {
          type: "subscription.canceled",
          gatewayEventId: String(obj["id"] ?? `${eventName}-${resource?.id ?? "unknown"}`),
          gatewaySubscriptionId: resource?.id ?? "",
        };
      }
    }

    // Evento de pedido/cobrança: o próprio Order, com charges[].status
    const charges = obj["charges"] as Array<{ id: string; status: string }> | undefined;
    const charge = charges?.[0];
    if (charge) {
      const gatewayEventId = String(obj["id"] ?? charge.id);
      if (charge.status === "PAID") {
        return {
          type: "charge.paid",
          gatewayEventId,
          gatewayChargeId: charge.id,
          paidAt: new Date().toISOString(),
        };
      }
      if (charge.status === "DECLINED" || charge.status === "CANCELED") {
        return {
          type: "charge.failed",
          gatewayEventId,
          gatewayChargeId: charge.id,
          reason: charge.status,
        };
      }
    }

    throw new Error("PagBank webhook: formato de evento não reconhecido.");
  }
}

function mapSubscriptionStatus(status: string): "active" | "pending" | "failed" {
  if (status === "ACTIVE") return "active";
  if (status === "PENDING" || status === "NEW") return "pending";
  return "failed";
}
