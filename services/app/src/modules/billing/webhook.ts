import { UnauthorizedError, platformPrisma, recordAudit, sendTransactionalEmail, withTenant } from "@estoque-saas/shared";
import { getPaymentProvider } from "./provider";

interface GatewayRefLookupRow {
  tenant_id: string;
  invoice_id: string | null;
  subscription_id: string | null;
}

interface PaymentConfirmationEmailData {
  to: string;
  amountCents: number;
  periodStart: Date | null;
  periodEnd: Date | null;
}

// Duplicado (não importado de @/lib/format) de propósito — modules/* não importa de services/app's
// lib/ hoje (sem precedente no código, ver docs/guides/contributing.md's regra de fronteira de
// módulo), e são só duas linhas de formatação pt-BR.
function centsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function dateToBR(date: Date | null): string {
  return date ? date.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—";
}

function buildPaymentConfirmationHtml(data: PaymentConfirmationEmailData): string {
  return `
    <p>Seu pagamento foi confirmado!</p>
    <p><strong>Valor:</strong> ${centsToBRL(data.amountCents)}</p>
    <p><strong>Período da assinatura:</strong> ${dateToBR(data.periodStart)} a ${dateToBR(data.periodEnd)}</p>
  `;
}

// Webhook do PagBank (api/openapi/billing.yaml#pagbankWebhook) — verifica assinatura ANTES de
// qualquer leitura/mutação de banco, idempotente por gateway_event_id (constraint UNIQUE em
// invoices.gateway_event_id — uma reentrega não processa duas vezes).
//
// rawBody DEVE ser o corpo bruto da requisição (string, não um objeto já reparseado) — a
// verificação de assinatura do PagBank é byte-sensível (ver PagBankProvider.verifyWebhookSignature).
//
// Log em cada decisão do fluxo (nunca o rawBody/signature/payload inteiro — só tipo de evento e
// ids) — até esta mudança o caminho de sucesso não deixava rastro nenhum: um 200 de "sem match" e
// um 200 de "fatura realmente atualizada" eram indistinguíveis de fora, e uma assinatura inválida
// (UnauthorizedError é um AppError) nem cai no log genérico de erro não tratado do handleRoute.
export async function processPagBankWebhook(rawBody: string, signatureHeader: string | null): Promise<void> {
  const provider = getPaymentProvider();

  if (!signatureHeader || !provider.verifyWebhookSignature(rawBody, signatureHeader)) {
    console.warn("[webhook-pagbank] assinatura ausente ou inválida — requisição rejeitada (401)");
    throw new UnauthorizedError("Assinatura do webhook inválida.");
  }

  const payload = JSON.parse(rawBody) as unknown;
  const event = provider.parseWebhookEvent(payload);
  console.log(`[webhook-pagbank] recebido, assinatura válida: type=${event.type}`);

  const chargeId = event.type === "charge.paid" || event.type === "charge.failed" ? event.gatewayChargeId : null;
  const subscriptionId = event.type === "subscription.canceled" ? event.gatewaySubscriptionId : null;

  const rows = await platformPrisma.$queryRaw<GatewayRefLookupRow[]>`
    SELECT * FROM billing_lookup_tenant_by_gateway_ref(${chargeId}, ${subscriptionId})
  `;
  const match = rows[0];
  if (!match) {
    // Evento não corresponde a nenhuma fatura/assinatura conhecida — descarta silenciosamente
    // (pode ser um evento de um ambiente diferente, ex: sandbox vs produção). Nunca lança 500 aqui.
    console.warn(`[webhook-pagbank] sem match: type=${event.type} chargeId=${chargeId ?? "-"} subscriptionId=${subscriptionId ?? "-"} — descartado`);
    return;
  }

  // code-reviewer finding HI-4: a check-then-act idempotency guard (SELECT, branch in app code,
  // then UPDATE) has a window under READ COMMITTED — two near-simultaneous deliveries of the SAME
  // webhook event (gateways routinely re-deliver on timeout, not a contrived scenario) can both
  // pass the SELECT-based check before either commits, and both run the side effects a second
  // time (duplicate audit_log entry, subscription.updateMany run twice). Fixed by making the
  // UPDATE ITSELF the atomic guard: `updateMany`'s WHERE encodes "not yet applied", and its
  // returned `count` (0 vs 1) tells this transaction whether it won the race — never a prior
  // SELECT. Same fix shape applied to all three event types, not just charge.paid, since all
  // three had the identical check-then-act pattern.
  // Retornado de dentro de withTenant (em vez de capturado numa variável mutável externa) —
  // devolver o dado necessário evita segurar a conexão/transação aberta enquanto o e-mail (chamada
  // HTTP externa ao Resend) é enviado depois, fora da transação.
  const paymentConfirmationEmail = await withTenant(match.tenant_id, async (tx): Promise<PaymentConfirmationEmailData | null> => {
    if (event.type === "charge.paid" && match.invoice_id) {
      const updated = await tx.invoice.updateMany({
        where: { id: match.invoice_id, OR: [{ gatewayEventId: null }, { gatewayEventId: { not: event.gatewayEventId } }] },
        data: { status: "paid", paidAt: new Date(event.paidAt), gatewayEventId: event.gatewayEventId },
      });
      if (updated.count === 0) {
        console.log(`[webhook-pagbank] charge.paid tenant=${match.tenant_id} invoice=${match.invoice_id} — já aplicado antes (idempotência), ignorando`);
        return null; // already applied by this or a concurrent/prior delivery
      }
      if (!match.subscription_id) {
        console.log(`[webhook-pagbank] charge.paid tenant=${match.tenant_id} invoice=${match.invoice_id} — fatura marcada paid, sem assinatura associada`);
        return null;
      }

      await tx.subscription.updateMany({ where: { id: match.subscription_id }, data: { status: "active" } });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "invoice", entityId: match.invoice_id, action: "update", after: { status: "paid" } });
      console.log(`[webhook-pagbank] charge.paid tenant=${match.tenant_id} invoice=${match.invoice_id} subscription=${match.subscription_id} — fatura paid, assinatura active`);

      const [invoice, subscription, admin] = await Promise.all([
        tx.invoice.findUnique({ where: { id: match.invoice_id } }),
        tx.subscription.findUnique({ where: { id: match.subscription_id } }),
        tx.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } }),
      ]);
      if (!invoice || !admin) return null;
      return {
        to: admin.email,
        amountCents: invoice.amountCents,
        periodStart: subscription?.currentPeriodStart ?? null,
        periodEnd: subscription?.currentPeriodEnd ?? null,
      };
    }

    if (event.type === "charge.failed" && match.invoice_id) {
      const updated = await tx.invoice.updateMany({
        where: { id: match.invoice_id, status: { not: "failed" } },
        data: { status: "failed" },
      });
      if (updated.count === 0) {
        console.log(`[webhook-pagbank] charge.failed tenant=${match.tenant_id} invoice=${match.invoice_id} — já aplicado antes (idempotência), ignorando`);
        return null;
      }
      if (!match.subscription_id) {
        console.log(`[webhook-pagbank] charge.failed tenant=${match.tenant_id} invoice=${match.invoice_id} — fatura marcada failed, sem assinatura associada`);
        return null;
      }

      await tx.subscription.updateMany({ where: { id: match.subscription_id }, data: { status: "past_due" } });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "invoice", entityId: match.invoice_id, action: "update", after: { status: "failed" } });
      console.log(`[webhook-pagbank] charge.failed tenant=${match.tenant_id} invoice=${match.invoice_id} subscription=${match.subscription_id} — fatura failed, assinatura past_due`);
      return null;
    }

    if (event.type === "subscription.canceled" && match.subscription_id) {
      const updated = await tx.subscription.updateMany({
        where: { id: match.subscription_id, status: { not: "canceled" } },
        data: { status: "canceled" },
      });
      if (updated.count === 0) {
        console.log(`[webhook-pagbank] subscription.canceled tenant=${match.tenant_id} subscription=${match.subscription_id} — já aplicado antes (idempotência), ignorando`);
        return null;
      }

      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "subscription", entityId: match.subscription_id, action: "update", after: { status: "canceled" } });
      console.log(`[webhook-pagbank] subscription.canceled tenant=${match.tenant_id} subscription=${match.subscription_id} — assinatura canceled`);
    }
    return null;
  });

  // Fora da transação de propósito — sendTransactionalEmail faz uma chamada HTTP externa (Resend)
  // e nunca lança (best-effort), mas ainda assim não deve segurar a conexão/transação do banco
  // aberta enquanto espera essa chamada.
  if (paymentConfirmationEmail) {
    await sendTransactionalEmail({
      to: paymentConfirmationEmail.to,
      subject: "Pagamento confirmado — Zolo",
      html: buildPaymentConfirmationHtml(paymentConfirmationEmail),
    });
  }
}
