import { UnauthorizedError, platformPrisma, recordAudit, withTenant } from "@estoque-saas/shared";
import { getPaymentProvider } from "./provider";

interface GatewayRefLookupRow {
  tenant_id: string;
  invoice_id: string | null;
  subscription_id: string | null;
}

// Webhook do PagBank (api/openapi/billing.yaml#pagbankWebhook) — verifica assinatura ANTES de
// qualquer leitura/mutação de banco, idempotente por gateway_event_id (constraint UNIQUE em
// invoices.gateway_event_id — uma reentrega não processa duas vezes).
//
// rawBody DEVE ser o corpo bruto da requisição (string, não um objeto já reparseado) — a
// verificação de assinatura do PagBank é byte-sensível (ver PagBankProvider.verifyWebhookSignature).
export async function processPagBankWebhook(rawBody: string, signatureHeader: string | null): Promise<void> {
  const provider = getPaymentProvider();

  if (!signatureHeader || !provider.verifyWebhookSignature(rawBody, signatureHeader)) {
    throw new UnauthorizedError("Assinatura do webhook inválida.");
  }

  const payload = JSON.parse(rawBody) as unknown;
  const event = provider.parseWebhookEvent(payload);

  const chargeId = event.type === "charge.paid" || event.type === "charge.failed" ? event.gatewayChargeId : null;
  const subscriptionId = event.type === "subscription.canceled" ? event.gatewaySubscriptionId : null;

  const rows = await platformPrisma.$queryRaw<GatewayRefLookupRow[]>`
    SELECT * FROM billing_lookup_tenant_by_gateway_ref(${chargeId}, ${subscriptionId})
  `;
  const match = rows[0];
  if (!match) {
    // Evento não corresponde a nenhuma fatura/assinatura conhecida — descarta silenciosamente
    // (pode ser um evento de um ambiente diferente, ex: sandbox vs produção). Nunca lança 500 aqui.
    return;
  }

  await withTenant(match.tenant_id, async (tx) => {
    if (event.type === "charge.paid" && match.invoice_id) {
      // Idempotência: gateway_event_id é UNIQUE (schema) — se este evento já foi aplicado
      // (reentrega do mesmo webhook), não reprocessa.
      const invoice = await tx.invoice.findUnique({ where: { id: match.invoice_id } });
      if (!invoice || invoice.gatewayEventId === event.gatewayEventId) return;

      await tx.invoice.update({
        where: { id: match.invoice_id },
        data: { status: "paid", paidAt: new Date(event.paidAt), gatewayEventId: event.gatewayEventId },
      });
      await tx.subscription.updateMany({ where: { id: invoice.subscriptionId }, data: { status: "active" } });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "invoice", entityId: match.invoice_id, action: "update", after: { status: "paid" } });
    }

    if (event.type === "charge.failed" && match.invoice_id) {
      const invoice = await tx.invoice.findUnique({ where: { id: match.invoice_id } });
      if (!invoice || invoice.status === "failed") return;

      await tx.invoice.update({ where: { id: match.invoice_id }, data: { status: "failed" } });
      await tx.subscription.updateMany({ where: { id: invoice.subscriptionId }, data: { status: "past_due" } });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "invoice", entityId: match.invoice_id, action: "update", after: { status: "failed" } });
    }

    if (event.type === "subscription.canceled" && match.subscription_id) {
      const subscription = await tx.subscription.findUnique({ where: { id: match.subscription_id } });
      if (!subscription || subscription.status === "canceled") return;

      await tx.subscription.update({ where: { id: match.subscription_id }, data: { status: "canceled" } });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "subscription", entityId: match.subscription_id, action: "update", after: { status: "canceled" } });
    }
  });
}
