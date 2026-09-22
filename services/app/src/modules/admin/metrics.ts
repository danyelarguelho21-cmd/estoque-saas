import { platformAdminPrisma } from "@estoque-saas/shared";

export interface PlatformMetrics {
  mrrCents: number;
  activeTenantsCount: number;
  pastDueTenantsCount: number;
  churnRateLast30d: number;
  newTenantsLast30d: number;
}

// api/openapi/admin.yaml#getPlatformMetrics — MRR = soma do priceCents do plano de cada
// subscription 'active'. Churn (30d) = assinaturas canceladas nos últimos 30 dias / assinaturas
// ativas há 30 dias (aproximação simples, adequada à escala do MVP — ver ADR-002 contexto de
// escala <1000 tenants).
export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [activeSubscriptions, pastDueCount, canceledLast30d, activeThirtyDaysAgoCount, newTenantsLast30d] = await Promise.all([
    platformAdminPrisma.subscription.findMany({ where: { status: "active" }, include: { plan: true } }),
    platformAdminPrisma.subscription.count({ where: { status: "past_due" } }),
    platformAdminPrisma.subscription.count({ where: { status: "canceled", createdAt: { gte: thirtyDaysAgo } } }),
    platformAdminPrisma.subscription.count({ where: { createdAt: { lt: thirtyDaysAgo } } }),
    platformAdminPrisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  const mrrCents = activeSubscriptions.reduce((sum, s) => sum + s.plan.priceCents, 0);
  const churnRateLast30d = activeThirtyDaysAgoCount > 0 ? canceledLast30d / activeThirtyDaysAgoCount : 0;

  return {
    mrrCents,
    activeTenantsCount: activeSubscriptions.length,
    pastDueTenantsCount: pastDueCount,
    churnRateLast30d,
    newTenantsLast30d,
  };
}
