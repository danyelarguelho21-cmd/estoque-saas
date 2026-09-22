import { withTenant } from "@estoque-saas/shared";

export interface SupplierInput {
  name: string;
  cnpj?: string | undefined;
  contact?: string | undefined;
}

export interface ListSuppliersFilters {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function listSuppliers(tenantId: string, filters: ListSuppliersFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const suppliers = await tx.supplier.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = suppliers.length > limit;
    const page = hasMore ? suppliers.slice(0, limit) : suppliers;
    return { items: page, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
  });
}

export async function createSupplier(tenantId: string, input: SupplierInput) {
  return withTenant(tenantId, (tx) =>
    tx.supplier.create({ data: { tenantId, name: input.name, cnpj: input.cnpj ?? null, contact: input.contact ?? null } }),
  );
}
