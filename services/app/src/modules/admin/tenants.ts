import { NotFoundError, platformAdminPrisma } from "@estoque-saas/shared";

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
        cnpj: tenant.cnpj,
        planName: tenant.plan.name,
        subscriptionStatus: subscription?.status ?? "trialing",
        status: tenant.status,
        createdAt: tenant.createdAt,
      };
    }),
  );

  return { items, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
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
