import {
  NotFoundError,
  assertWithinPlanLimit,
  recordAudit,
  withTenant,
  type TenantScopedClient,
} from "@estoque-saas/shared";
import { randomInt } from "node:crypto";
import { getTenantWithPlan } from "@/modules/auth";
import { getCurrentStock, getCurrentStockForProducts } from "@/modules/stock";

export interface ProductInput {
  sku?: string | undefined;
  name: string;
  categoryId?: string | undefined;
  unitOfMeasure: string;
  barcode?: string | undefined;
  supplierId?: string | undefined;
  isPerishable?: boolean | undefined;
  minStockGlobal?: number | undefined;
  costPriceCents?: number | undefined;
  salePriceCents?: number | undefined;
}

export interface ListProductsFilters {
  search?: string | undefined;
  belowMinStock?: boolean | undefined;
  storeId?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

async function withCurrentStock<T extends { id: string }>(tx: TenantScopedClient, product: T, storeId?: string) {
  const currentStock = await getCurrentStock(tx, product.id, storeId);
  return { ...product, currentStock };
}

export async function listProducts(tenantId: string, filters: ListProductsFilters) {
  const limit = filters.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({
      where: {
        deletedAt: null,
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: "insensitive" } },
                { sku: { contains: filters.search, mode: "insensitive" } },
                { barcode: { contains: filters.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = products.length > limit;
    const page = hasMore ? products.slice(0, limit) : products;

    // code-reviewer finding HI-1: was one getCurrentStock query PER product in the page (up to
    // 101, since the route clamps limit to 100) via Promise.all — now one batched query.
    const stockByProduct = await getCurrentStockForProducts(tx, page.map((p) => p.id), filters.storeId);
    let withStock = page.map((p) => ({ ...p, currentStock: stockByProduct.get(p.id) ?? 0 }));
    if (filters.belowMinStock) {
      withStock = withStock.filter((p) => p.currentStock < p.minStockGlobal);
    }

    return { items: withStock, page: { next_cursor: hasMore ? (page.at(-1)?.id ?? null) : null, has_more: hasMore } };
  });
}

export async function getProduct(tenantId: string, productId: string) {
  return withTenant(tenantId, async (tx) => {
    const product = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new NotFoundError("Produto não encontrado.");
    return withCurrentStock(tx, product);
  });
}

export async function createProduct(tenantId: string, userId: string, input: ProductInput) {
  const tenant = await getTenantWithPlan(tenantId);

  return withTenant(tenantId, async (tx) => {
    const currentCount = await tx.product.count({ where: { deletedAt: null } });
    assertWithinPlanLimit("products", currentCount, {
      maxProducts: tenant.plan.maxProducts,
      maxUsers: tenant.plan.maxUsers,
      maxStores: tenant.plan.maxStores,
    });

    const product = await tx.product.create({
      data: {
        tenantId,
        sku: input.sku?.trim() || null,
        name: input.name,
        categoryId: input.categoryId ?? null,
        unitOfMeasure: input.unitOfMeasure,
        barcode: input.barcode ?? null,
        supplierId: input.supplierId ?? null,
        isPerishable: input.isPerishable ?? false,
        minStockGlobal: input.minStockGlobal ?? 0,
        costPriceCents: input.costPriceCents ?? 0,
        salePriceCents: input.salePriceCents ?? 0,
      },
    });

    await recordAudit(tx, { tenantId, userId, entityType: "product", entityId: product.id, action: "create", after: { sku: product.sku, name: product.name } });

    return withCurrentStock(tx, product);
  });
}

function makeEan13() {
  const body = String(randomInt(100_000_000_000, 1_000_000_000_000));
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export async function prepareProductLabels(tenantId: string, productIds: string[]) {
  return withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({ where: { id: { in: productIds }, deletedAt: null } });
    if (products.length !== productIds.length) throw new NotFoundError("Um ou mais produtos não foram encontrados.");
    const labels = [];
    for (const product of products) {
      let barcode = product.barcode;
      if (!barcode) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const candidate = makeEan13();
          const exists = await tx.product.findFirst({ where: { barcode: candidate } });
          if (!exists) {
            barcode = candidate;
            break;
          }
        }
        if (!barcode) throw new Error("Não foi possível reservar um código de barras único.");
        await tx.product.update({ where: { id: product.id }, data: { barcode } });
      }
      labels.push({ id: product.id, name: product.name, sku: product.sku, barcode });
    }
    return labels;
  });
}

export type ProductUpdateInput = Partial<{ [K in keyof ProductInput]: ProductInput[K] | undefined }>;

export async function updateProduct(tenantId: string, userId: string, productId: string, input: ProductUpdateInput) {
  return withTenant(tenantId, async (tx) => {
    const before = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!before) throw new NotFoundError("Produto não encontrado.");

    const product = await tx.product.update({
      where: { id: productId },
      data: {
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.unitOfMeasure !== undefined ? { unitOfMeasure: input.unitOfMeasure } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.isPerishable !== undefined ? { isPerishable: input.isPerishable } : {}),
        ...(input.minStockGlobal !== undefined ? { minStockGlobal: input.minStockGlobal } : {}),
        ...(input.costPriceCents !== undefined ? { costPriceCents: input.costPriceCents } : {}),
        ...(input.salePriceCents !== undefined ? { salePriceCents: input.salePriceCents } : {}),
      },
    });

    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "product",
      entityId: product.id,
      action: "update",
      before: { sku: before.sku, name: before.name },
      after: { sku: product.sku, name: product.name },
    });

    return withCurrentStock(tx, product);
  });
}

export async function deleteProduct(tenantId: string, userId: string, productId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const before = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!before) throw new NotFoundError("Produto não encontrado.");

    await tx.product.update({ where: { id: productId }, data: { deletedAt: new Date() } });

    await recordAudit(tx, { tenantId, userId, entityType: "product", entityId: productId, action: "delete", before: { sku: before.sku } });
  });
}

export async function setProductStoreMinStock(tenantId: string, productId: string, storeId: string, minStockOverride: number | null) {
  return withTenant(tenantId, (tx) =>
    tx.productStoreSetting.upsert({
      where: { productId_storeId: { productId, storeId } },
      create: { tenantId, productId, storeId, minStockOverride },
      update: { minStockOverride },
    }),
  );
}
