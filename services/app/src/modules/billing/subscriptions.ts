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
// (ADR-004) — status fica 'pending_payment' até o webhook confirmar a cobrança Pix; o endpoint
// de checkout gera a cobrança antes de responder e o worker cuida dos ciclos seguintes.
export async function createSubscription(tenantId: string, input: CreateSubscriptionInput) {
  // `tenants` é RLS-protegida (ADR-002) — platformPrisma nunca tem app.tenant_id setado, então
  // uma leitura direta sempre falhava (bug real encontrado testando via Docker; ver comentário em
  // modules/auth/tenant.ts#getTenantWithPlan para o histórico completo). `plans` não é RLS-scoped,
  // platformPrisma continua correto para ele.
  const admin = await withTenant(tenantId, (tx) =>
    tx.user.findFirstOrThrow({ where: { role: "admin" }, orderBy: { createdAt: "asc" } }),
  );
  const tenant = await withTenant(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }));
  const plan = await platformPrisma.plan.findUniqueOrThrow({ where: { id: input.planId } });
  const gatewayPlanId = getVindiPlanId(plan.name);

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
      let result;
      try {
        result = await provider.createRecurringCardCharge({
          tenantId,
          planId: plan.id,
          ...(gatewayPlanId ? { gatewayPlanId } : {}),
          cardToken: input.cardToken,
          customerEmail: admin.email,
          customerName: tenant.name,
          customerTaxId: tenant.cnpj ?? tenant.cpf ?? "",
        });
      } catch (err) {
        const gatewayStatus = (err as { status?: unknown } | null)?.status;
        if (gatewayStatus === 400 || gatewayStatus === 402 || gatewayStatus === 422) {
          throw new PaymentRequiredError("Pagamento não aprovado. Confira os dados do cartão ou tente outro método de pagamento.");
        }
        throw err;
      }
      if (result.status === "failed") {
        throw new PaymentRequiredError("Pagamento recusado pela operadora de cartão.");
      }

      const updated = await tx.subscription.update({
        where: { id: current.id },
        data: {
          planId: plan.id,
          // "active" só quando o gateway confirma a cobrança síncrona do cartão de verdade
          // (result.status já teria lançado PaymentRequiredError acima se "failed") —
          // "pending_payment", não "active"/"trialing", no caso contrário (sem período de teste,
          // ver rbac.ts).
          status: result.status === "active" ? "active" : "pending_payment",
          paymentMethod: "card",
          gatewaySubscriptionId: result.gatewaySubscriptionId,
          gatewayCustomerId: result.gatewayCustomerId,
          currentPeriodStart: new Date(),
          currentPeriodEnd: addOneMonth(new Date()),
        },
      });
      if (result.initialCharge) {
        await tx.invoice.create({
          data: {
            tenantId,
            subscriptionId: current.id,
            amountCents: plan.priceCents,
            status: result.initialChargeStatus === "paid" ? "paid" : result.initialChargeStatus === "failed" ? "failed" : "pending",
            dueDate: result.initialCharge.dueDate ? new Date(result.initialCharge.dueDate) : new Date(),
            paidAt: result.initialChargeStatus === "paid" ? new Date() : null,
            paymentMethod: "card",
            gatewayChargeId: result.initialCharge.gatewayChargeId,
            boletoUrl: result.initialCharge.boletoUrl ?? null,
          },
        });
      }
      await recordAudit(tx, { tenantId, userId: null, entityType: "subscription", entityId: updated.id, action: "update", after: { status: updated.status, paymentMethod: "card" } });
      return updated;
    }

    // BUG FIX (found via manual e2e testing): this branch used to ALSO set currentPeriodStart/End
    // here (currentPeriodStart=now, currentPeriodEnd=+1 month) — as if a period had already been
    // paid for. generateChargeForTenant()'s own due-check is `!currentPeriodEnd ||
    // currentPeriodEnd <= now`, so setting a future currentPeriodEnd here made a BRAND NEW
    // pix_boleto subscription permanently NOT due until a month had passed — the very act of
    // choosing pix/boleto at checkout disabled the "primeiro ciclo gerado automaticamente" promise
    // (cadastro/page.tsx) for 30 days, so "Assinatura → Faturas" stayed empty indefinitely.
    // Leaving both fields untouched here (they're already null from signup.ts's initial
    // pending_payment row) keeps this subscription "due" so createOrGetInitialInvoice() can create
    // the first invoice immediately. generateChargeForTenant() sets these fields after generation.
    //
    // BUG FIX #2 (found live via manual test in production, 2026-09-28): status virava "active"
    // AQUI, antes de qualquer pagamento real — uma sessão válida já bastava pra acesso pleno ao
    // painel (Produtos/Estoque/Vendas), sem nenhuma fatura paga. Este produto não tem período de
    // teste (BRD: pagar pra usar). Mantém "pending_payment" — só o webhook do PagBank
    // (modules/billing/webhook.ts, evento charge.paid) promove pra "active", quando o pagamento é
    // de fato confirmado. requireSession/requireRole (modules/auth/rbac.ts) bloqueiam acesso
    // pleno enquanto o status for pending_payment/trialing.
    const provider = getPaymentProvider();
    if (provider.createRecurringPixCharge) {
      if (!gatewayPlanId) throw new PaymentRequiredError(`Plano ${plan.name} sem ID configurado na Vindi.`);
      let result;
      try {
        result = await provider.createRecurringPixCharge({
          tenantId,
          planId: plan.id,
          gatewayPlanId,
          customerEmail: admin.email,
          customerName: tenant.name,
          customerTaxId: tenant.cnpj ?? tenant.cpf ?? "",
        });
      } catch (err) {
        const status = (err as { status?: unknown } | null)?.status;
        if (status === 401 || status === 403) {
          throw new PaymentRequiredError("A Vindi recusou o acesso. Confirme se a chave privada e o plano são do mesmo ambiente Sandbox.");
        }
        if (status === 400 || status === 402 || status === 422) {
          throw new PaymentRequiredError("A Vindi rejeitou a assinatura. Confira o plano Básico, a cobrança imediata e os métodos habilitados no Sandbox.");
        }
        throw err;
      }
      if (!result.initialCharge?.gatewayChargeId || (!result.initialCharge.pixQrCode && !result.initialCharge.boletoUrl)) {
        throw new PaymentRequiredError("A Vindi criou a assinatura, mas não retornou a fatura inicial com link ou código Pix. Confira se o plano Sandbox está configurado para cobrança imediata.");
      }
      const updated = await tx.subscription.update({
        where: { id: current.id },
        data: {
          planId: plan.id,
          status: result.initialChargeStatus === "paid" ? "active" : "pending_payment",
          paymentMethod: "pix_boleto",
          gatewaySubscriptionId: result.gatewaySubscriptionId,
          gatewayCustomerId: result.gatewayCustomerId,
        },
      });
      await tx.invoice.create({
        data: {
          tenantId,
          subscriptionId: current.id,
          amountCents: plan.priceCents,
          status: result.initialChargeStatus === "paid" ? "paid" : result.initialChargeStatus === "failed" ? "failed" : "pending",
          dueDate: result.initialCharge.dueDate ? new Date(result.initialCharge.dueDate) : new Date(),
          paidAt: result.initialChargeStatus === "paid" ? new Date() : null,
          paymentMethod: "pix",
          gatewayChargeId: result.initialCharge.gatewayChargeId,
          pixQrCode: result.initialCharge.pixQrCode ?? null,
          boletoUrl: result.initialCharge.boletoUrl ?? null,
        },
      });
      await recordAudit(tx, { tenantId, userId: null, entityType: "subscription", entityId: updated.id, action: "update", after: { status: updated.status, paymentMethod: "pix_boleto" } });
      return updated;
    }

    const updated = await tx.subscription.update({
      where: { id: current.id },
      data: {
        planId: plan.id,
        status: "pending_payment",
        paymentMethod: "pix_boleto",
      },
    });
    await recordAudit(tx, { tenantId, userId: null, entityType: "subscription", entityId: updated.id, action: "update", after: { status: updated.status, paymentMethod: "pix_boleto" } });
    return updated;
  });
}

function getVindiPlanId(planName: string): string | undefined {
  if (process.env.PAYMENT_PROVIDER !== "vindi") return undefined;
  const normalized = planName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const suffix = normalized === "BASICO" ? "BASICO" : normalized;
  return process.env[`VINDI_PLAN_ID_${suffix}`] || undefined;
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
