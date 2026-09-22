import { listActiveTenantIds, platformPrisma, recordAudit, withTenant } from "@estoque-saas/shared";
import { getPaymentProvider } from "./provider";

// Processor do job `generate-monthly-charge` (worker) — sequence-billing.md: para tenants com
// paymentMethod='pix_boleto' (sem recorrência nativa disponível no PagBank, ADR-004), o PRÓPRIO
// sistema gera uma cobrança avulsa mensal via API de Pedidos quando o período atual vence.
// Varre todos os tenants ativos (listActiveTenantIds) — cada um processado dentro do seu próprio
// withTenant(), nunca lendo dados de outro tenant.
export async function generateMonthlyCharges(): Promise<{ generated: number; skipped: number }> {
  const tenantIds = await listActiveTenantIds();
  let generated = 0;
  let skipped = 0;

  for (const tenantId of tenantIds) {
    const didGenerate = await generateChargeForTenant(tenantId);
    if (didGenerate) generated++;
    else skipped++;
  }

  return { generated, skipped };
}

async function generateChargeForTenant(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const subscription = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" } });
    if (!subscription || subscription.paymentMethod !== "pix_boleto") return false;
    if (subscription.status !== "active" && subscription.status !== "trialing") return false;

    const due = !subscription.currentPeriodEnd || subscription.currentPeriodEnd <= new Date();
    if (!due) return false;

    const plan = await platformPrisma.plan.findUnique({ where: { id: subscription.planId } });
    if (!plan) return false;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 5);
    const dueDateIso = dueDate.toISOString().slice(0, 10);

    const provider = getPaymentProvider();
    const charge = await provider.createOneOffCharge({
      tenantId,
      amountCents: plan.priceCents,
      dueDate: dueDateIso,
      method: "pix",
      customerEmail: `financeiro+${tenantId}@estoque-saas.invalid`,
    });

    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        subscriptionId: subscription.id,
        amountCents: plan.priceCents,
        status: "pending",
        dueDate,
        paymentMethod: "pix",
        gatewayChargeId: charge.gatewayChargeId,
        pixQrCode: charge.pixQrCode ?? null,
      },
    });

    const periodStart = new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    });

    await recordAudit(tx, {
      tenantId,
      userId: null,
      entityType: "invoice",
      entityId: invoice.id,
      action: "create",
      after: { amountCents: invoice.amountCents, dueDate: dueDateIso },
    });

    return true;
  });
}
