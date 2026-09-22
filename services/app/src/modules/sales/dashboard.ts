import { withTenant } from "@estoque-saas/shared";
import { getCurrentStock } from "@/modules/stock";

export interface DashboardDateFilter {
  storeId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

// api/openapi/dashboard.yaml#getAbcCurve — classifica produtos por contribuição acumulada de
// receita ou quantidade (classe A = até 80% acumulado, B = até 95%, C = restante).
export async function getAbcCurve(tenantId: string, opts: DashboardDateFilter & { metric?: "revenue" | "quantity" | undefined }) {
  const metric = opts.metric ?? "revenue";
  return withTenant(tenantId, async (tx) => {
    const items = await tx.saleItem.findMany({
      where: {
        sale: {
          status: "completed",
          ...(opts.storeId ? { storeId: opts.storeId } : {}),
          ...(opts.from || opts.to
            ? { createdAt: { ...(opts.from ? { gte: new Date(opts.from) } : {}), ...(opts.to ? { lte: new Date(opts.to) } : {}) } }
            : {}),
        },
      },
      include: { sale: false },
    });

    const byProduct = new Map<string, number>();
    for (const item of items) {
      const value = metric === "revenue" ? item.quantity * item.unitPriceCents : item.quantity;
      byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + value);
    }

    const products = await tx.product.findMany({ where: { id: { in: [...byProduct.keys()] } } });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    const sorted = [...byProduct.entries()].sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((sum, [, v]) => sum + v, 0);

    let cumulative = 0;
    return sorted.map(([productId, value]) => {
      cumulative += value;
      const cumulativePercentage = total > 0 ? (cumulative / total) * 100 : 0;
      const klass = cumulativePercentage <= 80 ? "A" : cumulativePercentage <= 95 ? "B" : "C";
      return { productId, productName: nameById.get(productId) ?? "", value, cumulativePercentage, class: klass };
    });
  });
}

// api/openapi/dashboard.yaml#getStockTurnover — giro = quantidade vendida (últimos 90 dias) /
// saldo atual. Produto sem saldo atual e sem vendas -> taxa 0.
export async function getStockTurnover(tenantId: string, opts: { storeId?: string | undefined; groupBy?: "product" | "category" | undefined }) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  return withTenant(tenantId, async (tx) => {
    const movements = await tx.stockMovement.findMany({
      where: { type: "saida_venda", createdAt: { gte: ninetyDaysAgo }, ...(opts.storeId ? { storeId: opts.storeId } : {}) },
    });

    const soldByProduct = new Map<string, number>();
    for (const m of movements) {
      soldByProduct.set(m.productId, (soldByProduct.get(m.productId) ?? 0) + Math.abs(m.quantity));
    }

    const products = await tx.product.findMany({ where: { id: { in: [...soldByProduct.keys()] } }, include: { category: true } });

    if ((opts.groupBy ?? "product") === "category") {
      const byCategory = new Map<string, { name: string; sold: number }>();
      for (const product of products) {
        const key = product.categoryId ?? "sem-categoria";
        const name = product.category?.name ?? "Sem categoria";
        const entry = byCategory.get(key) ?? { name, sold: 0 };
        entry.sold += soldByProduct.get(product.id) ?? 0;
        byCategory.set(key, entry);
      }
      return [...byCategory.entries()].map(([id, { name, sold }]) => ({ id, name, turnoverRate: sold }));
    }

    return Promise.all(
      products.map(async (product) => {
        const currentStock = await getCurrentStock(tx, product.id, opts.storeId);
        const sold = soldByProduct.get(product.id) ?? 0;
        return { id: product.id, name: product.name, turnoverRate: currentStock > 0 ? sold / currentStock : sold };
      }),
    );
  });
}

// api/openapi/dashboard.yaml#getStalledProducts — produtos sem NENHUMA movimentação nos últimos N dias.
export async function getStalledProducts(tenantId: string, opts: { storeId?: string | undefined; days?: number | undefined }) {
  const days = opts.days ?? 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return withTenant(tenantId, async (tx) => {
    const products = await tx.product.findMany({ where: { deletedAt: null } });
    const result: Array<{ productId: string; productName: string; lastMovementAt: string | null }> = [];

    for (const product of products) {
      const last = await tx.stockMovement.findFirst({
        where: { productId: product.id, ...(opts.storeId ? { storeId: opts.storeId } : {}) },
        orderBy: { createdAt: "desc" },
      });
      if (!last || last.createdAt < cutoff) {
        result.push({ productId: product.id, productName: product.name, lastMovementAt: last?.createdAt.toISOString() ?? null });
      }
    }
    return result;
  });
}

// api/openapi/dashboard.yaml#getBestSellers
export async function getBestSellers(tenantId: string, opts: DashboardDateFilter & { limit?: number | undefined }) {
  const limit = opts.limit ?? 20;
  return withTenant(tenantId, async (tx) => {
    const items = await tx.saleItem.findMany({
      where: {
        sale: {
          status: "completed",
          ...(opts.storeId ? { storeId: opts.storeId } : {}),
          ...(opts.from || opts.to
            ? { createdAt: { ...(opts.from ? { gte: new Date(opts.from) } : {}), ...(opts.to ? { lte: new Date(opts.to) } : {}) } }
            : {}),
        },
      },
    });

    const byProduct = new Map<string, { quantitySold: number; revenueCents: number }>();
    for (const item of items) {
      const entry = byProduct.get(item.productId) ?? { quantitySold: 0, revenueCents: 0 };
      entry.quantitySold += item.quantity;
      entry.revenueCents += item.quantity * item.unitPriceCents;
      byProduct.set(item.productId, entry);
    }

    const products = await tx.product.findMany({ where: { id: { in: [...byProduct.keys()] } } });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    return [...byProduct.entries()]
      .map(([productId, agg]) => ({ productId, productName: nameById.get(productId) ?? "", ...agg }))
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, limit);
  });
}
