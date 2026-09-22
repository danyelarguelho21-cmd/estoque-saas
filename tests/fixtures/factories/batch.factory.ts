// Factory for the pure FEFO domain shape (ADR-006). Kept independent of Prisma-generated types
// (the Batch model may still change shape during BUILD) — mirrors schemas/migrations/0001_init.sql
// `batches` columns 1:1 so it stays valid once Prisma catches up.

export interface BatchFixture {
  id: string;
  productId: string;
  storeId: string;
  batchNumber: string;
  expiryDate: string; // ISO date (YYYY-MM-DD)
  quantity: number;
}

let counter = 0;

export function makeBatch(overrides: Partial<BatchFixture> = {}): BatchFixture {
  counter += 1;
  return {
    id: overrides.id ?? `batch-${counter}`,
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
