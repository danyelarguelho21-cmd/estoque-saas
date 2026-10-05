import { ConflictError, NotFoundError, platformAdminPrisma } from "@estoque-saas/shared";
import { signupTenant, type SignupInput } from "@/modules/auth";

export interface ListTenantsAdminFilters {
  subscriptionStatus?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

// api/openapi/admin.yaml#listTenantsAdmin — usa platformAdminPrisma (role com BYPASSRLS
// deliberado, ver schemas/migrations/0006) porque este é o ÚNICO fluxo do sistema que precisa
// enxergar tenants além do próprio (o painel do dono da plataforma).
export async function listTenantsAdmin(filters: ListTenantsAdminFilters) {
  const limit = filters.limit ?? 20;

  const subscriptions = filters.subscriptionStatus
    ? await platformAdminPrisma.subscription.findMany({
        where: { status: filters.subscriptionStatus },
        select: { tenantId: true },
      })
    : null;

  const tenants = await platformAdminPrisma.tenant.findMany({
    where: subscriptions ? { id: { in: subscriptions.map((s) => s.tenantId) } } : {},
    include: { plan: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
  });
  const hasMore = tenants.length > limit;
  const page = hasMore ? tenants.slice(0, limit) : tenants;

  const items = await Promise.all(
    page.map(async (tenant) => {
      const subscription = await platformAdminPrisma.subscription.findFirst({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
      });
      return {
        id: tenant.id,
        name: tenant.name,
        personType: tenant.personType as "PF" | "PJ",
        cnpj: tenant.cnpj,
        cpf: tenant.cpf,
        planName: tenant.plan.name,
        subscriptionStatus: subscription?.status ?? "trialing",
        trialEndsAt: subscription?.trialEndsAt ?? null,
        // Acesso cortesia: ativo sem assinatura no gateway (liberado manualmente no painel).
        courtesyAccess: subscription?.status === "active" && !subscription.gatewaySubscriptionId,
        status: tenant.status,
        createdAt: tenant.createdAt,
      };
    }),
  );

  return { items, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
}

// Teste gratuito liberado manualmente pelo dono da plataforma: a assinatura mais recente vira
// "trialing" até `days` dias a partir de agora (ver rbac.ts#isSubscriptionBlocked). Assinatura já
// paga ("active") não é tocada, para nunca sobrescrever um cliente pagante.
export async function grantTrial(tenantId: string, days: number) {
  const subscription = await platformAdminPrisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!subscription) throw new NotFoundError("Assinatura não encontrada para este tenant.");
  if (subscription.status === "active") {
    throw new ConflictError("Este cliente já tem uma assinatura paga e ativa — não é preciso liberar teste.");
  }
  const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return platformAdminPrisma.subscription.update({ where: { id: subscription.id }, data: { status: "trialing", trialEndsAt } });
}

// Acesso liberado sem cobrança e sem prazo (parceiros, cortesias). A assinatura vira "active" sem
// vínculo com o gateway, o que a distingue de um cliente pagante. O período fica longo para nenhuma
// rotina de cobrança considerá-la vencida.
export async function grantAccess(tenantId: string) {
  const subscription = await platformAdminPrisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!subscription) throw new NotFoundError("Assinatura não encontrada para este tenant.");
  if (subscription.status === "active" && subscription.gatewaySubscriptionId) {
    throw new ConflictError("Este cliente já tem uma assinatura paga e ativa.");
  }
  const now = new Date();
  const farFuture = new Date(now);
  farFuture.setFullYear(farFuture.getFullYear() + 10);
  return platformAdminPrisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "active", trialEndsAt: null, currentPeriodStart: now, currentPeriodEnd: farFuture },
  });
}

// Remove um acesso cortesia: volta para "pending_payment". Nunca mexe em assinatura paga.
export async function revokeAccess(tenantId: string) {
  const subscription = await platformAdminPrisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!subscription) throw new NotFoundError("Assinatura não encontrada para este tenant.");
  if (subscription.status !== "active" || subscription.gatewaySubscriptionId) {
    throw new ConflictError("Só é possível remover acesso liberado manualmente (cortesia), não de cliente pagante.");
  }
  return platformAdminPrisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "pending_payment", trialEndsAt: null, currentPeriodStart: null, currentPeriodEnd: null },
  });
}

// Encerra o teste antes da data: volta para "pending_payment" e o cliente precisa pagar para usar.
export async function endTrial(tenantId: string) {
  const subscription = await platformAdminPrisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!subscription) throw new NotFoundError("Assinatura não encontrada para este tenant.");
  if (subscription.status !== "trialing") throw new ConflictError("Este cliente não está em período de teste.");
  return platformAdminPrisma.subscription.update({ where: { id: subscription.id }, data: { status: "pending_payment", trialEndsAt: null } });
}

export type AdminTenantAccess = { type: "courtesy" } | { type: "trial"; days: number } | { type: "pending" };

// Cadastro feito pelo dono da plataforma no painel /admin: cria empresa, usuário admin, loja e
// assinatura exatamente como o cadastro público (signupTenant) e, em seguida, aplica o acesso
// escolhido — cortesia sem prazo, teste por N dias ou aguardando pagamento normal.
export async function createTenantByAdmin(input: SignupInput, access: AdminTenantAccess) {
  const result = await signupTenant(input);
  if (access.type === "courtesy") await grantAccess(result.tenantId);
  if (access.type === "trial") await grantTrial(result.tenantId, access.days);
  return result;
}

export async function suspendTenant(tenantId: string) {
  const tenant = await platformAdminPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError("Tenant não encontrado.");
  return platformAdminPrisma.tenant.update({ where: { id: tenantId }, data: { status: "suspended" } });
}

export async function reactivateTenant(tenantId: string) {
  const tenant = await platformAdminPrisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError("Tenant não encontrado.");
  return platformAdminPrisma.tenant.update({ where: { id: tenantId }, data: { status: "active" } });
}
