import { withTenant } from "@estoque-saas/shared";

export interface ListInvoicesFilters {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function listInvoices(tenantId: string, filters: ListInvoicesFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const invoices = await tx.invoice.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = invoices.length > limit;
    const page = hasMore ? invoices.slice(0, limit) : invoices;
    return { items: page, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
  });
}
