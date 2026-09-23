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

  // code-reviewer finding HI-4: a check-then-act idempotency guard (SELECT, branch in app code,
  // then UPDATE) has a window under READ COMMITTED — two near-simultaneous deliveries of the SAME
  // webhook event (gateways routinely re-deliver on timeout, not a contrived scenario) can both
  // pass the SELECT-based check before either commits, and both run the side effects a second
  // time (duplicate audit_log entry, subscription.updateMany run twice). Fixed by making the
  // UPDATE ITSELF the atomic guard: `updateMany`'s WHERE encodes "not yet applied", and its
  // returned `count` (0 vs 1) tells this transaction whether it won the race — never a prior
  // SELECT. Same fix shape applied to all three event types, not just charge.paid, since all
  // three had the identical check-then-act pattern.
  await withTenant(match.tenant_id, async (tx) => {
    if (event.type === "charge.paid" && match.invoice_id) {
      const updated = await tx.invoice.updateMany({
        where: { id: match.invoice_id, OR: [{ gatewayEventId: null }, { gatewayEventId: { not: event.gatewayEventId } }] },
        data: { status: "paid", paidAt: new Date(event.paidAt), gatewayEventId: event.gatewayEventId },
      });
      if (updated.count === 0 || !match.subscription_id) return; // already applied by this or a concurrent/prior delivery

      await tx.subscription.updateMany({ where: { id: match.subscription_id }, data: { status: "active" } });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "invoice", entityId: match.invoice_id, action: "update", after: { status: "paid" } });
    }

    if (event.type === "charge.failed" && match.invoice_id) {
      const updated = await tx.invoice.updateMany({
        where: { id: match.invoice_id, status: { not: "failed" } },
        data: { status: "failed" },
      });
      if (updated.count === 0 || !match.subscription_id) return;

      await tx.subscription.updateMany({ where: { id: match.subscription_id }, data: { status: "past_due" } });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "invoice", entityId: match.invoice_id, action: "update", after: { status: "failed" } });
    }

    if (event.type === "subscription.canceled" && match.subscription_id) {
      const updated = await tx.subscription.updateMany({
        where: { id: match.subscription_id, status: { not: "canceled" } },
        data: { status: "canceled" },
      });
      if (updated.count === 0) return;

      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "subscription", entityId: match.subscription_id, action: "update", after: { status: "canceled" } });
    }
  });
}
