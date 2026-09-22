import { platformPrisma } from "@estoque-saas/shared";

// Planos são tabela global (fora do RLS de tenant, ADR-002) — usa platformPrisma diretamente.
export async function listPlans() {
  return platformPrisma.plan.findMany({ orderBy: { priceCents: "asc" } });
}
