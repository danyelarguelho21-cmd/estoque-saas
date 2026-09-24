import { withTenant } from "@estoque-saas/shared";
import { parseProductsCsv } from "./csv-parser";

// Processor do job de importação CSV (services/app/src/worker/index.ts, fila
// `import-products-csv` — na prática reaproveitamos a mesma infra de fila do parse-nfe, mas com
// nome de fila próprio). Best-effort por linha: SKUs duplicados/erros de uma linha não abortam o
// restante do arquivo — cada linha é uma tentativa independente de createProduct.
export async function processProductsCsvJob(tenantId: string, csvText: string): Promise<{ created: number; skipped: number }> {
  const { rows } = parseProductsCsv(csvText);
  let created = 0;
  let skipped = 0;

  await withTenant(tenantId, async (tx) => {
    for (const row of rows) {
      const exists = row.sku
        ? await tx.product.findFirst({ where: { sku: row.sku, deletedAt: null } })
        : row.barcode
          ? await tx.product.findFirst({ where: { barcode: row.barcode, deletedAt: null } })
          : null;
      if (exists) {
        skipped++;
        continue;
      }
      await tx.product.create({
        data: {
          tenantId,
          sku: row.sku?.trim() || null,
          name: row.name,
          unitOfMeasure: row.unitOfMeasure,
          categoryId: row.categoryId ?? null,
          barcode: row.barcode ?? null,
          supplierId: row.supplierId ?? null,
          isPerishable: row.isPerishable ?? false,
          minStockGlobal: row.minStockGlobal ?? 0,
          costPriceCents: row.costPriceCents ?? 0,
          salePriceCents: row.salePriceCents ?? 0,
        },
      });
      created++;
    }
  });

  return { created, skipped };
}
