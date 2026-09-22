import { withTenant } from "@estoque-saas/shared";

export interface CustomerInput {
  name: string;
  document?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
}

export interface ListCustomersFilters {
  search?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function listCustomers(tenantId: string, filters: ListCustomersFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const customers = await tx.customer.findMany({
      where: filters.search
        ? { OR: [{ name: { contains: filters.search, mode: "insensitive" } }, { document: { contains: filters.search } }] }
        : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = customers.length > limit;
    const page = hasMore ? customers.slice(0, limit) : customers;
    return { items: page, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
  });
}

export async function createCustomer(tenantId: string, input: CustomerInput) {
  return withTenant(tenantId, (tx) =>
    tx.customer.create({
      data: { tenantId, name: input.name, document: input.document ?? null, phone: input.phone ?? null, email: input.email ?? null },
    }),
  );
}

export async function getCustomerHistory(tenantId: string, customerId: string) {
  return withTenant(tenantId, (tx) =>
    tx.sale.findMany({ where: { customerId }, include: { items: true }, orderBy: { createdAt: "desc" } }),
  );
}
