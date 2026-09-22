import { assertWithinPlanLimit, recordAudit, withTenant } from "@estoque-saas/shared";
import { getTenantWithPlan } from "./tenant";

export interface StoreInput {
  name: string;
  type: "loja" | "deposito";
  address?: string | undefined;
}

export interface ListStoresFilters {
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function listStores(tenantId: string, filters: ListStoresFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const stores = await tx.store.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = stores.length > limit;
    const page = hasMore ? stores.slice(0, limit) : stores;
    return { items: page, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
  });
}

export async function createStore(tenantId: string, userId: string, input: StoreInput) {
  const tenant = await getTenantWithPlan(tenantId);
  return withTenant(tenantId, async (tx) => {
    const currentCount = await tx.store.count();
    assertWithinPlanLimit("stores", currentCount, {
      maxProducts: tenant.plan.maxProducts,
      maxUsers: tenant.plan.maxUsers,
      maxStores: tenant.plan.maxStores,
    });
    const store = await tx.store.create({ data: { tenantId, name: input.name, type: input.type, address: input.address ?? null } });
    await recordAudit(tx, { tenantId, userId, entityType: "store", entityId: store.id, action: "create", after: { name: store.name } });
    return store;
  });
}

export type StoreUpdateInput = Partial<{ [K in keyof StoreInput]: StoreInput[K] | undefined }>;

export async function updateStore(tenantId: string, userId: string, storeId: string, input: StoreUpdateInput) {
  return withTenant(tenantId, async (tx) => {
    const before = await tx.store.findUniqueOrThrow({ where: { id: storeId } });
    const store = await tx.store.update({
      where: { id: storeId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
      },
    });
    await recordAudit(tx, { tenantId, userId, entityType: "store", entityId: storeId, action: "update", before: { name: before.name }, after: { name: store.name } });
    return store;
  });
}
