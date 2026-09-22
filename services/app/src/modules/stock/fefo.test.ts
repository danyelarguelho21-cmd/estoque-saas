import { describe, expect, it } from "vitest";
import { suggestFefoBatches } from "./fefo";

describe("suggestFefoBatches", () => {
  it("suggests the single batch closest to expiry when it fully covers the request", () => {
    const result = suggestFefoBatches(
      [
        { batchId: "b1", expiryDate: "2026-12-01", quantity: 50 },
        { batchId: "b2", expiryDate: "2026-10-01", quantity: 30 },
      ],
      20,
    );
    expect(result.fullyCovered).toBe(true);
    expect(result.suggestions).toEqual([{ batchId: "b2", expiryDate: "2026-10-01", quantity: 20 }]);
  });

  it("spans multiple batches in expiry order when one is not enough", () => {
    const result = suggestFefoBatches(
      [
        { batchId: "b1", expiryDate: "2026-12-01", quantity: 50 },
        { batchId: "b2", expiryDate: "2026-10-01", quantity: 5 },
        { batchId: "b3", expiryDate: "2026-11-01", quantity: 10 },
      ],
      12,
    );
    expect(result.fullyCovered).toBe(true);
    expect(result.suggestions).toEqual([
      { batchId: "b2", expiryDate: "2026-10-01", quantity: 5 },
      { batchId: "b3", expiryDate: "2026-11-01", quantity: 7 },
    ]);
  });

  it("reports fullyCovered=false and returns everything available when stock is insufficient", () => {
    const result = suggestFefoBatches([{ batchId: "b1", expiryDate: "2026-10-01", quantity: 3 }], 10);
    expect(result.fullyCovered).toBe(false);
    expect(result.suggestions).toEqual([{ batchId: "b1", expiryDate: "2026-10-01", quantity: 3 }]);
  });

  it("ignores batches with zero or negative quantity", () => {
    const result = suggestFefoBatches(
      [
        { batchId: "b1", expiryDate: "2026-10-01", quantity: 0 },
        { batchId: "b2", expiryDate: "2026-11-01", quantity: 5 },
      ],
      5,
    );
    expect(result.suggestions).toEqual([{ batchId: "b2", expiryDate: "2026-11-01", quantity: 5 }]);
  });

  it("throws for a non-positive requested quantity (precondition violation, per OpenAPI minimum: 1)", () => {
    const batches = [{ batchId: "b1", expiryDate: "2026-10-01", quantity: 5 }];
    expect(() => suggestFefoBatches(batches, 0)).toThrow();
    expect(() => suggestFefoBatches(batches, -1)).toThrow();
  });

  it("is pure — does not mutate the input batches array", () => {
    const batches = [{ batchId: "b1", expiryDate: "2026-10-01", quantity: 5 }];
    const snapshot = JSON.parse(JSON.stringify(batches));
    suggestFefoBatches(batches, 3);
    expect(batches).toEqual(snapshot);
  });
});
