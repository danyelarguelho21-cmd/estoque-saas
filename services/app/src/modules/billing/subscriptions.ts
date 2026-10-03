import {
  ConflictError,
  NotFoundError,
  PaymentRequiredError,
  ValidationError,
  fitsWithinPlan,
  platformPrisma,
  recordAudit,
  tenantBillingAddress,
  withTenant,
  type PaymentProvider,
} from "@estoque-saas/shared";
import { resolveInvoiceAmount } from "./invoice-amount";
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
  const billingAddress = tenantBillingAddress(tenant);

  const pixProvider = getPaymentProvider();
  if (input.paymentMethod === "pix_boleto" && pixProvider.createRecurringPixCharge) {
    if (!gatewayPlanId) throw new PaymentRequiredError(`Plano ${plan.name} sem ID configurado na Vindi.`);
    if (!billingAddress) {
      throw new ValidationError("Cadastre o endereço de cobrança antes de gerar a cobrança Pix.", { field: "billingAddress" });
    }
    return createRecurringPixSubscription(tenantId, pixProvider, {
      planId: plan.id,
      priceCents: plan.priceCents,
      gatewayPlanId,
      customerEmail: admin.email,
      customerName: tenant.name,
      customerTaxId: tenant.cnpj ?? tenant.cpf ?? "",
      billingAddress,
    });
  }

  if (input.paymentMethod === "card") {
    if (!input.cardToken) {
      throw new PaymentRequiredError("cardToken é obrigatório para pagamento via cartão.");
    }
    return createRecurringCardSubscription(tenantId, getPaymentProvider(), {
      planId: plan.id,
      priceCents: plan.priceCents,
      ...(gatewayPlanId ? { gatewayPlanId } : {}),
      cardToken: input.cardToken,
      customerEmail: admin.email,
      customerName: tenant.name,
      customerTaxId: tenant.cnpj ?? tenant.cpf ?? "",
      ...(billingAddress ? { billingAddress } : {}),
    });
  }

  return withTenant(tenantId, async (tx) => {
    const current = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" } });
    if (!current) {
      throw new NotFoundError("Assinatura não encontrada para este tenant.");
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

type RecurringCardCheckout = Omit<Parameters<PaymentProvider["createRecurringCardCharge"]>[0], "tenantId" | "planId"> & {
  planId: string;
  priceCents: number;
};

// Checkout com cartão — mesmo motivo do Pix (ver createRecurringPixSubscription): as chamadas ao
// gateway (cliente, perfil de pagamento, assinatura) ficavam dentro de withTenant e podiam estourar
// o timeout de 5s da transação, cobrando o cartão na Vindi sem gravar nada localmente. Agora o
// gateway é chamado fora da transação, e a assinatura é cancelada se a gravação local falhar.
async function createRecurringCardSubscription(tenantId: string, provider: PaymentProvider, checkout: RecurringCardCheckout) {
  const current = await withTenant(tenantId, (tx) => tx.subscription.findFirst({ orderBy: { createdAt: "desc" } }));
  if (!current) {
    throw new NotFoundError("Assinatura não encontrada para este tenant.");
  }

  let result;
  try {
    result = await provider.createRecurringCardCharge({ ...checkout, tenantId });
  } catch (err) {
    const gatewayStatus = (err as { status?: unknown } | null)?.status;
    if (process.env.PAYMENT_PROVIDER === "vindi" && (gatewayStatus === 401 || gatewayStatus === 402 || gatewayStatus === 403)) {
      throw new PaymentRequiredError(gatewayStatus === 402
        ? "A conta Vindi Sandbox está bloqueada para cobranças. Confira o status da conta no painel da Vindi."
        : "A Vindi recusou o acesso. Confirme se a chave privada e o plano pertencem ao mesmo ambiente Sandbox.");
    }
    if (process.env.PAYMENT_PROVIDER === "vindi" && (gatewayStatus === 400 || gatewayStatus === 422)) {
      throw new PaymentRequiredError("A Vindi não aceitou o cartão ou os dados da assinatura. Confira os dados e os métodos habilitados no plano Sandbox.");
    }
    if (gatewayStatus === 400 || gatewayStatus === 402 || gatewayStatus === 422) {
      throw new PaymentRequiredError("Pagamento não aprovado. Confira os dados do cartão ou tente outro método de pagamento.");
    }
    throw err;
  }
  if (result.status === "failed") {
    throw new PaymentRequiredError("Pagamento recusado pela operadora de cartão.");
  }

  try {
    return await withTenant(tenantId, async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: current.id },
        data: {
          planId: checkout.planId,
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
            amountCents: resolveInvoiceAmount(result.initialCharge, checkout.priceCents, `tenant=${tenantId} checkout cartão`),
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
    });
  } catch (err) {
    await cancelUnpersistedSubscription(provider, result.gatewaySubscriptionId, tenantId);
    throw err;
  }
}

// Assinatura criada no gateway mas não gravada localmente: cancela para não deixar cobrança órfã.
async function cancelUnpersistedSubscription(provider: PaymentProvider, gatewaySubscriptionId: string, tenantId: string) {
  try {
    await provider.cancelSubscription(gatewaySubscriptionId);
  } catch (cancelErr) {
    console.error(`[billing] assinatura ${gatewaySubscriptionId} criada no gateway mas não persistida e não cancelada (tenant ${tenantId}):`, cancelErr instanceof Error ? cancelErr.message : cancelErr);
  }
}

type RecurringPixCheckout = Omit<Parameters<NonNullable<PaymentProvider["createRecurringPixCharge"]>>[0], "tenantId" | "planId"> & {
  planId: string;
  priceCents: number;
};

// Checkout Pix com recorrência nativa (Vindi). As chamadas ao gateway ficam FORA de withTenant:
// criar cliente + assinatura + aguardar o QR (waitForPixQrCode, até ~7,5s) estourava o timeout
// padrão de 5s da transação interativa do Prisma — a assinatura nascia na Vindi e a transação
// local era abortada ("Transaction already closed"), deixando uma cobrança órfã sem fatura local.
// Agora: lê o estado → chama o gateway → persiste numa transação curta (e cancela na Vindi se a
// persistência falhar).
async function createRecurringPixSubscription(tenantId: string, provider: PaymentProvider, checkout: RecurringPixCheckout) {
  const createRecurringPixCharge = provider.createRecurringPixCharge!.bind(provider);
  const { current, openInvoice } = await withTenant(tenantId, async (tx) => {
    const current = await tx.subscription.findFirst({ orderBy: { createdAt: "desc" } });
    const openInvoice = current
      ? await tx.invoice.findFirst({
          where: { subscriptionId: current.id, status: { in: ["pending", "overdue"] } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        })
      : null;
    return { current, openInvoice };
  });
  if (!current) {
    throw new NotFoundError("Assinatura não encontrada para este tenant.");
  }

  // Retry do checkout ("Gerar cobrança Pix" em /assinatura) com uma assinatura Vindi ainda não paga:
  // - fatura aberta COM QR → nada a gerar, a rota devolve a fatura existente (idempotente);
  // - fatura sem QR (ex.: recusada pelo gateway por falta de endereço) → substitui a assinatura,
  //   senão cada clique deixava mais uma assinatura/fatura em aberto na Vindi. As faturas locais
  //   são marcadas "failed" ANTES do cancelamento: o webhook bill_canceled que chega depois vira
  //   no-op (charge.failed só age em fatura ainda não failed) e não rebaixa a assinatura.
  if (current.gatewaySubscriptionId && current.status === "pending_payment") {
    if (openInvoice?.pixQrCode) return current;
    await withTenant(tenantId, (tx) =>
      tx.invoice.updateMany({ where: { subscriptionId: current.id, status: { in: ["pending", "overdue"] } }, data: { status: "failed" } }),
    );
    try {
      await provider.cancelSubscription(current.gatewaySubscriptionId);
    } catch (err) {
      console.error(`[billing] falha ao cancelar a assinatura Vindi anterior ${current.gatewaySubscriptionId} (tenant ${tenantId}):`, err instanceof Error ? err.message : err);
    }
  }

  let result;
  try {
    result = await createRecurringPixCharge({ ...checkout, tenantId });
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    console.error(`[billing] falha na criação da assinatura Pix Vindi (status=${String(status ?? "desconhecido")})`, err instanceof Error ? err.message : "erro desconhecido", JSON.stringify((err as { body?: unknown })?.body ?? null));
    if (status === 401 || status === 403) {
      throw new PaymentRequiredError("A Vindi recusou o acesso. Confirme se a chave privada e o plano são do mesmo ambiente Sandbox.");
    }
    if (status === 402) {
      throw new PaymentRequiredError("A conta Vindi Sandbox está bloqueada para cobranças. Confira o status da conta no painel da Vindi.");
    }
    if (status === 400 || status === 422) {
      throw new PaymentRequiredError("A Vindi rejeitou a assinatura. Confira o plano Básico, a cobrança imediata e os métodos habilitados no Sandbox.");
    }
    throw err;
  }
  const initialCharge = result.initialCharge;
  if (!initialCharge?.gatewayChargeId || (!initialCharge.pixQrCode && !initialCharge.boletoUrl)) {
    throw new PaymentRequiredError("A Vindi criou a assinatura, mas não retornou a fatura inicial com link ou código Pix. Confira se o plano Sandbox está configurado para cobrança imediata.");
  }

  try {
    return await withTenant(tenantId, async (tx) => {
      const updated = await tx.subscription.update({
        where: { id: current.id },
        data: {
          planId: checkout.planId,
          status: result.initialChargeStatus === "paid" ? "active" : "pending_payment",
          paymentMethod: "pix_boleto",
          gatewaySubscriptionId: result.gatewaySubscriptionId,
          gatewayCustomerId: result.gatewayCustomerId,
        },
      });
      // O webhook bill_created desta fatura pode ter chegado (e sido rejeitado para nova tentativa)
      // enquanto o gateway era consultado; quando reentregue, encontra esta fatura e não duplica.
      await tx.invoice.create({
        data: {
          tenantId,
          subscriptionId: current.id,
          amountCents: resolveInvoiceAmount(initialCharge, checkout.priceCents, `tenant=${tenantId} checkout Pix`),
          status: result.initialChargeStatus === "paid" ? "paid" : result.initialChargeStatus === "failed" ? "failed" : "pending",
          dueDate: initialCharge.dueDate ? new Date(initialCharge.dueDate) : new Date(),
          paidAt: result.initialChargeStatus === "paid" ? new Date() : null,
          paymentMethod: "pix",
          gatewayChargeId: initialCharge.gatewayChargeId,
          pixQrCode: initialCharge.pixQrCode ?? null,
          boletoUrl: initialCharge.boletoUrl ?? null,
        },
      });
      await recordAudit(tx, { tenantId, userId: null, entityType: "subscription", entityId: updated.id, action: "update", after: { status: updated.status, paymentMethod: "pix_boleto" } });
      return updated;
    });
  } catch (err) {
    await cancelUnpersistedSubscription(provider, result.gatewaySubscriptionId, tenantId);
    throw err;
  }
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
