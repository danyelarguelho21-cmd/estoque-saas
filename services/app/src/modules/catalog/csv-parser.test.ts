import { describe, expect, it } from "vitest";
import { parseProductsCsv } from "./csv-parser";

describe("parseProductsCsv", () => {
  it("parses valid rows with required + optional columns", () => {
    const csv = [
      "sku,name,unitOfMeasure,barcode,isPerishable,minStockGlobal,costPriceCents,salePriceCents",
      "SKU-1,Arroz 5kg,un,7891234567890,false,10,1500,2590",
      "SKU-2,Leite Integral,cx,,true,5,300,499",
    ].join("\n");

    const result = parseProductsCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      sku: "SKU-1",
      name: "Arroz 5kg",
      unitOfMeasure: "un",
      barcode: "7891234567890",
      isPerishable: false,
      minStockGlobal: 10,
      costPriceCents: 1500,
      salePriceCents: 2590,
    });
    expect(result.rows[1]?.isPerishable).toBe(true);
  });

  it("handles quoted fields containing commas", () => {
    const csv = ['sku,name,unitOfMeasure', 'SKU-1,"Arroz, Tipo 1, 5kg",un'].join("\n");
    const result = parseProductsCsv(csv);
    expect(result.rows[0]?.name).toBe("Arroz, Tipo 1, 5kg");
  });

  it("reports an error and skips rows missing required fields", () => {
    const csv = ["sku,name,unitOfMeasure", "SKU-1,,un", "SKU-2,Produto Válido,cx"].join("\n");
    const result = parseProductsCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(2);
  });

  it("errors out immediately when required columns are missing from the header", () => {
    const result = parseProductsCsv("sku,name\nSKU-1,Produto");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toContain("unitOfMeasure");
  });

  it("returns an error for an empty file", () => {
    const result = parseProductsCsv("");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/vazio/i);
  });
});
