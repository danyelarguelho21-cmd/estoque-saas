import { describe, expect, it } from "vitest";
import { daysUntil, formatCentsToBRL, formatDateBR } from "./format";

describe("formatCentsToBRL", () => {
  it("formats cents as BRL currency", () => {
    expect(formatCentsToBRL(2990)).toContain("29,90");
  });

  it("returns an em dash for null/undefined", () => {
    expect(formatCentsToBRL(null)).toBe("—");
    expect(formatCentsToBRL(undefined)).toBe("—");
  });
});

describe("formatDateBR", () => {
  it("formats an ISO date string as pt-BR", () => {
    expect(formatDateBR("2026-12-25")).toMatch(/25\/12\/2026|24\/12\/2026/);
  });

  it("returns an em dash for invalid input", () => {
    expect(formatDateBR("not-a-date")).toBe("—");
    expect(formatDateBR(null)).toBe("—");
  });
});

describe("daysUntil", () => {
  it("returns 0 for today", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(daysUntil(today)).toBe(0);
  });

  it("returns a positive number for a future date", () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(daysUntil(future)).toBeGreaterThanOrEqual(9);
  });
});
