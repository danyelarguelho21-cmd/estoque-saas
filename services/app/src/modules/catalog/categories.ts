import { withTenant } from "@estoque-saas/shared";

export async function listCategories(tenantId: string) {
  return withTenant(tenantId, (tx) => tx.category.findMany({ orderBy: { name: "asc" } }));
}

export async function createCategory(tenantId: string, name: string) {
  return withTenant(tenantId, (tx) => tx.category.create({ data: { tenantId, name } }));
}
