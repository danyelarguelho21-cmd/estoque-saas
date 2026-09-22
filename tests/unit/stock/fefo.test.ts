// AC-003 / ADR-006 — FEFO suggestion is a pure, HTTP-independent function:
//   (batches with quantity > 0, ordered by expiry_date ASC) + requested quantity
//     -> ordered list of {batchId, quantity} covering as much of the request as possible.
//
// Contract assumption (documented per loop-protocol Rule 4 — TDD pair): the backend engineer
// implements this as `suggestFefoBatches` exported from `services/app/src/modules/stock/fefo.ts`,
// per ADR-006 §"Consequences" ("função pura e testável ... independente de HTTP"). If the
// solution-architect specifies a different export path/name, update the import below — the
// assertions (the actual contract) should not need to change.
//
// This file is expected to fail at collection time until that module exists — that is the
// correct RED state for Wave A (engineers build against this).
import { describe, expect, it } from "vitest";
import { suggestFefoBatches } from "@/modules/stock/fefo";
import { makeBatch, daysFromNow } from "../../fixtures/factories/batch.factory";

describe("suggestFefoBatches (AC-003, ADR-006)", () => {
  it("suggests the single batch expiring soonest when it fully covers the requested quantity", () => {
    const batches = [
      makeBatch({ id: "b-far", expiryDate: daysFromNow(90), quantity: 50 }),
      makeBatch({ id: "b-soon", expiryDate: daysFromNow(5), quantity: 20 }),
      makeBatch({ id: "b-mid", expiryDate: daysFromNow(30), quantity: 30 }),
    ];

    const result = suggestFefoBatches(batches, 10);

    expect(result.fullyCovered).toBe(true);
    expect(result.suggestions).toEqual([{ batchId: "b-soon", expiryDate: daysFromNow(5), quantity: 10 }]);
  });

  it("spills over into the next-soonest-expiring batch when the first is insufficient", () => {
    const batches = [
      makeBatch({ id: "b-soon", expiryDate: daysFromNow(5), quantity: 8 }),
      makeBatch({ id: "b-mid", expiryDate: daysFromNow(30), quantity: 30 }),
      makeBatch({ id: "b-far", expiryDate: daysFromNow(90), quantity: 50 }),
    ];

    const result = suggestFefoBatches(batches, 15);

    expect(result.fullyCovered).toBe(true);
    expect(result.suggestions).toEqual([
      { batchId: "b-soon", expiryDate: daysFromNow(5), quantity: 8 },
      { batchId: "b-mid", expiryDate: daysFromNow(30), quantity: 7 },
    ]);
  });

  it("returns fullyCovered=false and consumes every available batch when total stock is insufficient", () => {
    const batches = [
      makeBatch({ id: "b-1", expiryDate: daysFromNow(5), quantity: 3 }),
      makeBatch({ id: "b-2", expiryDate: daysFromNow(10), quantity: 4 }),
    ];

    const result = suggestFefoBatches(batches, 100);

    expect(result.fullyCovered).toBe(false);
    expect(result.suggestions).toEqual([
      { batchId: "b-1", expiryDate: daysFromNow(5), quantity: 3 },
      { batchId: "b-2", expiryDate: daysFromNow(10), quantity: 4 },
    ]);
  });

  it("ignores batches with zero or negative quantity", () => {
    const batches = [
      makeBatch({ id: "b-empty", expiryDate: daysFromNow(1), quantity: 0 }),
      makeBatch({ id: "b-has-stock", expiryDate: daysFromNow(5), quantity: 10 }),
    ];

    const result = suggestFefoBatches(batches, 5);

    expect(result.suggestions.map((s: { batchId: string }) => s.batchId)).toEqual(["b-has-stock"]);
  });

  it("returns an empty, fullyCovered=false suggestion when there are no batches at all", () => {
    const result = suggestFefoBatches([], 5);
    expect(result).toEqual({ suggestions: [], fullyCovered: false });
  });

  it("throws on a non-positive requested quantity (contract: quantity >= 1 per OpenAPI minimum)", () => {
    const batches = [makeBatch({ quantity: 10 })];
    expect(() => suggestFefoBatches(batches, 0)).toThrow();
    expect(() => suggestFefoBatches(batches, -1)).toThrow();
  });

  it("is a pure function — does not mutate the input batches array or its elements", () => {
    const batches = [makeBatch({ id: "b-1", quantity: 10 })];
    const snapshot = JSON.parse(JSON.stringify(batches));

    suggestFefoBatches(batches, 5);

    expect(batches).toEqual(snapshot);
  });
});
