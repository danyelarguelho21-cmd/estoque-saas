// Factory for the pure FEFO domain shape (ADR-006). Kept independent of Prisma-generated types
// (the Batch model may still change shape during BUILD) — mirrors schemas/migrations/0001_init.sql
// `batches` columns 1:1 so it stays valid once Prisma catches up.

export interface BatchFixture {
  id: string;
  /** Alias de `id` — mesmo valor, campo mantido separado porque a assinatura real de
   * `suggestFefoBatches` (services/app/src/modules/stock/fefo.ts, FefoBatchInput) usa `batchId`
   * como nome de campo, não `id`. Integration-seam encontrado no merge-back da Wave A: este
   * fixture foi escrito contra o contrato do domínio "Batch" completo (schemas/migrations),
   * FefoBatchInput é um subconjunto propositalmente estreito com outro nome de campo — ambos
   * corretos em seus próprios contextos, então o fixture carrega os dois em vez de escolher um. */
  batchId: string;
  productId: string;
  storeId: string;
  batchNumber: string;
  expiryDate: string; // ISO date (YYYY-MM-DD)
  quantity: number;
}

let counter = 0;

export function makeBatch(overrides: Partial<BatchFixture> = {}): BatchFixture {
  counter += 1;
  const id = overrides.id ?? overrides.batchId ?? `batch-${counter}`;
  return {
    id,
    batchId: id,
    productId: overrides.productId ?? "product-1",
    storeId: overrides.storeId ?? "store-1",
    batchNumber: overrides.batchNumber ?? `L${counter}`,
    expiryDate: overrides.expiryDate ?? "2026-12-31",
    quantity: overrides.quantity ?? 10,
  };
}

export function daysFromNow(days: number, from: Date = new Date("2026-09-21T00:00:00Z")): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
