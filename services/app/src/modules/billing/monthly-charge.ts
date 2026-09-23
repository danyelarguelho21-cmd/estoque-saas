import { listActiveTenantIds, lockOnKey, platformPrisma, recordAudit, withTenant } from "@estoque-saas/shared";
import { getPaymentProvider } from "./provider";

// Processor do job `generate-monthly-charge` (worker) — sequence-billing.md: para tenants com
// paymentMethod='pix_boleto' (sem recorrência nativa disponível no PagBank, ADR-004), o PRÓPRIO
// sistema gera uma cobrança avulsa mensal via API de Pedidos quando o período atual vence.
// Varre todos os tenants ativos (listActiveTenantIds) — cada um processado dentro do seu próprio
// withTenant(), nunca lendo dados de outro tenant.
export async function generateMonthlyCharges(): Promise<{ generated: number; skipped: number; failed: number }> {
  const tenantIds = await listActiveTenantIds();
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // BUG FIX (found live: a single tenant with bad billing data — e.g. an invalid CNPJ PagBank
  // rejects — silently blocked EVERY OTHER TENANT'S invoice, forever. The loop had no per-tenant
  // error isolation: one throw aborted the whole BullMQ job, which just retries the exact same
  // failing tenant again (still first in iteration order) — no other tenant's charge is EVER
  // generated until that one tenant's data is fixed, with zero visibility into which tenant or
  // why. `withTenant()` already isolates each tenant's own DB transaction; this isolates FAILURES
  // the same way, so one broken tenant degrades to "that tenant's invoice didn't generate today",
  // not "nobody's did."
  for (const tenantId of tenantIds) {
    try {
      const didGenerate = await generateChargeForTenant(tenantId);
      if (didGenerate) generated++;
      else skipped++;
    } catch (err) {
      failed++;
      console.error(`[generate-monthly-charge] falhou para tenant ${tenantId} — outros tenants continuam sendo processados:`, err instanceof Error ? err.message : err);
      const body = (err as { body?: unknown } | undefined)?.body;
      if (body !== undefined) console.error(`[generate-monthly-charge]   detalhe do erro (tenant ${tenantId}):`, JSON.stringify(body));
    }
  }

  return { generated, skipped, failed };
}

async function generateChargeForTenant(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    // Same contention fix as CR-1/HI-4 (see lockOnKey's doc comment, libs/shared/src/db/client.ts):
    // the daily cron and an immediate on-checkout enqueue (POST /api/billing/subscription) can now
    // both target the SAME tenant close together — without this, both could read `due` before
    // either commits its invoice, generating two charges for one billing cycle.
    await lockOnKey(tx, `generate-monthly-charge:${tenantId}`);

    const subscription = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" } });
    if (!subscription || subscription.paymentMethod !== "pix_boleto") return false;
    if (subscription.status !== "active" && subscription.status !== "trialing") return false;

    const due = !subscription.currentPeriodEnd || subscription.currentPeriodEnd <= new Date();
    if (!due) return false;

    const plan = await platformPrisma.plan.findUnique({ where: { id: subscription.planId } });
    if (!plan) return false;

    // BUG FIX (found live: every charge attempt got a real 400 from PagBank —
    // "customer.tax_id must be a valid CPF or CNPJ" — the provider used to hardcode tax_id="" and
    // pass the placeholder email as the name; PagBank's Orders API requires both, and the tenant's
    // own name/cnpj, collected at signup, are what they actually need to be).
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    // BUG FIX (found live, AFTER the tax_id/name fix above — a third, previously-hidden
    // validation error): the synthetic placeholder `financeiro+${tenantId}@estoque-saas.invalid`
    // is 68 characters once a full UUID is embedded, over PagBank's documented 60-char max for
    // customer.email ("size must be between 5 and 60"). Using the tenant admin's REAL email is
    // both the actual fix (well under 60 chars) and the more correct behavior — Pix/boleto
    // payment notifications should reach someone who can act on them, not an unreachable
    // ".invalid" placeholder. Falls back to the old placeholder only in the pathological case of
    // no admin user existing (should never happen — signup.ts always creates one).
    const admin = await tx.user.findFirst({ where: { role: "admin" }, orderBy: { createdAt: "asc" } });
    // Fallback also kept short (tenantId truncated, not the full UUID) — the very bug being fixed
    // here was an over-60-char email going unnoticed, so the fallback must not repeat it.
    const customerEmail = admin?.email ?? `financeiro+${tenantId.slice(0, 8)}@estoque-saas.invalid`;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 5);
    const dueDateIso = dueDate.toISOString().slice(0, 10);

    const provider = getPaymentProvider();
    const charge = await provider.createOneOffCharge({
      tenantId,
      amountCents: plan.priceCents,
      dueDate: dueDateIso,
      method: "pix",
      customerEmail,
      customerName: tenant.name,
      customerTaxId: tenant.cnpj,
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
