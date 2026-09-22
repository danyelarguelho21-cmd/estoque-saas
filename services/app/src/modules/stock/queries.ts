import { NotFoundError, withTenant } from "@estoque-saas/shared";

// Status e itens de um import de NF-e (api/openapi/stock.yaml#getNfeImport) — usado para polling
// da UI durante o parsing assíncrono (ADR-005).
export async function getNfeImport(tenantId: string, importId: string) {
  return withTenant(tenantId, async (tx) => {
    const nfeImport = await tx.nfeImport.findUnique({ where: { id: importId }, include: { items: true } });
    if (!nfeImport) {
      throw new NotFoundError("Import de NF-e não encontrado.");
    }
    return nfeImport;
  });
}

export interface ListStockMovementsFilters {
  storeId?: string | undefined;
  productId?: string | undefined;
  type?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

// Histórico de movimentações — auditável, paginado por cursor (createdAt desc + id como
// desempate). api/openapi/stock.yaml#listStockMovements.
export async function listStockMovements(tenantId: string, filters: ListStockMovementsFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const items = await tx.stockMovement.findMany({
      where: {
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.type ? { type: filters.type } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return {
      items: page,
      page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore },
    };
  });
}
