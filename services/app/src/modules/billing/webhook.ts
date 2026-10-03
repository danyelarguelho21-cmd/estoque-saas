import { UnauthorizedError, platformPrisma, recordAudit, sendTransactionalEmail, withTenant } from "@estoque-saas/shared";
import { getPagBankProvider, getPaymentProvider } from "./provider";
import { resolveInvoiceAmount } from "./invoice-amount";
import { VindiProvider } from "@estoque-saas/shared";

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
  const provider = getPagBankProvider();

  if (!signatureHeader || !provider.verifyWebhookSignature(rawBody, signatureHeader)) {
    console.warn("[webhook-pagbank] assinatura ausente ou inválida — requisição rejeitada (401)");
    throw new UnauthorizedError("Assinatura do webhook inválida.");
  }

  await processVerifiedWebhook(rawBody, provider);
}

export async function processVindiWebhook(rawBody: string, secret: string | null): Promise<void> {
  const provider = getPaymentProvider();
  if (!(provider instanceof VindiProvider) || !secret || !provider.verifyWebhookSignature(rawBody, secret)) {
    console.warn("[webhook-vindi] segredo ausente/inválido ou gateway não selecionado — requisição rejeitada");
    throw new UnauthorizedError("Autenticação do webhook Vindi inválida.");
  }
  await processVerifiedWebhook(rawBody, provider);
}

async function processVerifiedWebhook(rawBody: string, provider: VindiProvider | ReturnType<typeof getPagBankProvider>): Promise<void> {
  const payload = JSON.parse(rawBody) as unknown;
  const event = provider.parseWebhookEvent(payload);
  if (event.type === "ignored") {
    console.info(`[webhook-vindi] evento de verificação ou tipo não tratado recebido: ${event.gatewayEventId}`);
    return;
  }
  console.log(`[webhook-pagbank] recebido, assinatura válida: type=${event.type}`);

  const chargeId = event.type === "charge.paid" || event.type === "charge.failed" || event.type === "charge.created" || event.type === "charge.pix_updated" ? event.gatewayChargeId : null;
  const subscriptionId = event.type === "subscription.canceled" ? event.gatewaySubscriptionId : null;
  const relatedSubscriptionId = event.type === "charge.created" ? event.gatewaySubscriptionId : subscriptionId;

  const rows = await platformPrisma.$queryRaw<GatewayRefLookupRow[]>`
    SELECT * FROM billing_lookup_tenant_by_gateway_ref(${chargeId}, ${relatedSubscriptionId})
  `;
  const match = rows[0];
  if (!match) {
    // Evento não corresponde a nenhuma fatura/assinatura conhecida — descarta silenciosamente
    // (pode ser um evento de um ambiente diferente, ex: sandbox vs produção). Nunca lança 500 aqui.
    console.warn(`[webhook-pagbank] sem match: type=${event.type} chargeId=${chargeId ?? "-"} subscriptionId=${subscriptionId ?? "-"} — descartado`);
    if (provider instanceof VindiProvider) throw new Error("Vindi webhook ainda sem fatura/assinatura vinculada; solicitar nova tentativa.");
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
    if (event.type === "charge.created" && match.subscription_id) {
      const existing = await tx.invoice.findFirst({ where: { gatewayChargeId: event.gatewayChargeId } });
      if (existing) {
        // Fatura já criada pelo checkout: completa o QR (se a transação Pix ainda não tinha
        // concluído) e alinha o valor ao que a Vindi informa na fatura (bill.amount).
        const fillQr = !existing.pixQrCode && event.pixQrCode;
        const fixAmount = event.amountCents !== undefined && event.amountCents !== existing.amountCents;
        if (fixAmount) {
          console.warn(`[webhook-vindi] bill_created tenant=${match.tenant_id} invoice=${existing.id} — valor local ${existing.amountCents} difere do valor da Vindi ${event.amountCents} (centavos); usando o da Vindi.`);
        }
        if (fillQr || fixAmount) {
          await tx.invoice.update({
            where: { id: existing.id },
            data: { ...(fillQr ? { pixQrCode: event.pixQrCode } : {}), ...(fixAmount ? { amountCents: event.amountCents } : {}) },
          });
          console.log(`[webhook-vindi] bill_created tenant=${match.tenant_id} invoice=${existing.id} — fatura atualizada (${[fillQr && "QR Code Pix", fixAmount && "valor"].filter(Boolean).join(", ")})`);
        }
        return null;
      }
      const subscription = await tx.subscription.findUnique({ where: { id: match.subscription_id }, select: { planId: true } });
      const plan = subscription ? await tx.plan.findUnique({ where: { id: subscription.planId }, select: { priceCents: true } }) : null;
      // Sem bill.amount nem plano não há valor confiável — falha para a Vindi reentregar, em vez
      // de gravar uma fatura de R$ 0,00.
      if (event.amountCents === undefined && !plan) {
        throw new Error(`Vindi bill_created ${event.gatewayChargeId} sem valor e sem plano local para usar como referência.`);
      }
      const amountCents = plan
        ? resolveInvoiceAmount(event, plan.priceCents, `tenant=${match.tenant_id} webhook bill_created ${event.gatewayChargeId}`)
        : event.amountCents!;
      const invoice = await tx.invoice.create({
        data: {
          tenantId: match.tenant_id,
          subscriptionId: match.subscription_id,
          amountCents,
          status: "pending",
          dueDate: new Date(event.dueDate),
          paymentMethod: event.paymentMethod,
          gatewayChargeId: event.gatewayChargeId,
          gatewayEventId: event.gatewayEventId,
          pixQrCode: event.pixQrCode ?? null,
          boletoUrl: event.paymentUrl ?? null,
        },
      });
      await recordAudit(tx, { tenantId: match.tenant_id, userId: null, entityType: "invoice", entityId: invoice.id, action: "create", after: { status: "pending", amountCents: invoice.amountCents } });
      console.log(`[webhook-vindi] bill_created tenant=${match.tenant_id} invoice=${invoice.id} subscription=${match.subscription_id}`);
      return null;
    }

    // QR Code Pix que chegou depois da fatura (Vindi charge_created/charge_updated). Só preenche o
    // copia-e-cola de fatura ainda em aberto; não mexe em status. Idempotente: reentregas com o
    // mesmo código não alteram nada.
    if (event.type === "charge.pix_updated" && match.invoice_id) {
      const updated = await tx.invoice.updateMany({
        where: {
          id: match.invoice_id,
          status: { in: ["pending", "overdue"] },
          OR: [{ pixQrCode: null }, { pixQrCode: { not: event.pixQrCode } }],
        },
        data: { pixQrCode: event.pixQrCode, ...(event.paymentUrl ? { boletoUrl: event.paymentUrl } : {}) },
      });
      console.log(`[webhook-vindi] charge.pix_updated tenant=${match.tenant_id} invoice=${match.invoice_id} — ${updated.count ? "QR Code Pix atualizado" : "sem alteração"}`);
      return null;
    }

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
