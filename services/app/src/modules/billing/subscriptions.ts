import {
  ConflictError,
  NotFoundError,
  PaymentRequiredError,
  fitsWithinPlan,
  platformPrisma,
  recordAudit,
  withTenant,
} from "@estoque-saas/shared";
import { getPaymentProvider } from "./provider";

export async function getSubscription(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.subscription.findFirst({ where: {}, orderBy: { createdAt: "desc" } }));
}

export interface CreateSubscriptionInput {
  planId: string;
  paymentMethod: "card" | "pix_boleto";
  cardToken?: string | undefined;
}

// Assina um plano (api/openapi/billing.yaml#createSubscription) — atualiza a MESMA linha de
// subscription criada em trialing pelo signup (modules/auth/signup.ts), nunca cria uma segunda.
// Cartão: recorrência nativa PagBank. Pix/boleto: sem cobrança nativa recorrente disponível
// (ADR-004) — status vira 'active' e a cobrança mensal em si é gerada pelo job
// `generate-monthly-charge` (worker), não por este endpoint.
export async function createSubscription(tenantId: string, input: CreateSubscriptionInput) {
  // `tenants` é RLS-protegida (ADR-002) — platformPrisma nunca tem app.tenant_id setado, então
  // uma leitura direta sempre falhava (bug real encontrado testando via Docker; ver comentário em
  // modules/auth/tenant.ts#getTenantWithPlan para o histórico completo). `plans` não é RLS-scoped,
  // platformPrisma continua correto para ele.
  const tenant = await withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }));
  const plan = await platformPrisma.plan.findUniqueOrThrow({ where: { id: input.planId } });

  return withTenant(tenantId, async (tx) => {
    const current = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" } });
    if (!current) {
      throw new NotFoundError("Assinatura não encontrada para este tenant.");
    }

    if (input.paymentMethod === "card") {
      if (!input.cardToken) {
        throw new PaymentRequiredError("cardToken é obrigatório para pagamento via cartão.");
      }
      const provider = getPaymentProvider();
      const result = await provider.createRecurringCardCharge({
        tenantId,
        planId: plan.id,
        cardToken: input.cardToken,
        customerEmail: tenant.name,
      });
      if (result.status === "failed") {
        throw new PaymentRequiredError("Pagamento recusado pela operadora de cartão.");
      }

      const updated = await tx.subscription.update({
        where: { id: current.id },
        data: {
          planId: plan.id,
          status: result.status === "active" ? "active" : "trialing",
          paymentMethod: "card",
          gatewaySubscriptionId: result.gatewaySubscriptionId,
          gatewayCustomerId: result.gatewayCustomerId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addOneMonth(new Date()),
        },
      });
      await recordAudit(tx, { tenantId, userId: null, entityType: "subscription", entityId: updated.id, action: "update", after: { status: updated.status, paymentMethod: "card" } });
      return updated;
    }

    const updated = await tx.subscription.update({
      where: { id: current.id },
      data: {
        planId: plan.id,
        status: "active",
        paymentMethod: "pix_boleto",
        currentPeriodStart: new Date(),
        currentPeriodEnd: addOneMonth(new Date()),
      },
    });
    await recordAudit(tx, { tenantId, userId: null, entityType: "subscription", entityId: updated.id, action: "update", after: { status: updated.status, paymentMethod: "pix_boleto" } });
    return updated;
  });
}

// Upgrade/downgrade de plano (api/openapi/billing.yaml#changePlan) — bloqueia downgrade se o
// tenant excede os limites do plano alvo (ConflictError 409, ver libs/shared/plan-limits).
export async function changePlan(tenantId: string, targetPlanId: string) {
  const targetPlan = await platformPrisma.plan.findUniqueOrThrow({ where: { id: targetPlanId } });

  return withTenant(tenantId, async (tx) => {
    const [productCount, userCount, storeCount, current] = await Promise.all([
      tx.product.count({ where: { deletedAt: null } }),
      tx.user.count(),
      tx.store.count(),
      tx.subscription.findFirst({ orderBy: { createdAt: "desc" } }),
    ]);
    if (!current) {
      throw new NotFoundError("Assinatura não encontrada para este tenant.");
    }

    const fits = fitsWithinPlan(
      { products: productCount, users: userCount, stores: storeCount },
      { maxProducts: targetPlan.maxProducts, maxUsers: targetPlan.maxUsers, maxStores: targetPlan.maxStores },
    );
    if (fits !== true) {
      throw new ConflictError("Downgrade inválido — tenant excede os limites do plano alvo.", { violations: fits });
    }

    const updated = await tx.subscription.update({ where: { id: current.id }, data: { planId: targetPlanId } });
    await tx.tenant.update({ where: { id: tenantId }, data: { planId: targetPlanId } });
    return updated;
  });
}

function addOneMonth(date: Date): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  return d;
}
