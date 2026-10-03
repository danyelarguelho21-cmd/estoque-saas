import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInvoiceAmount } from "./invoice-amount";

afterEach(() => vi.restoreAllMocks());

describe("resolveInvoiceAmount", () => {
  it("usa o valor cobrado pelo gateway e avisa quando diverge do preço do plano", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveInvoiceAmount({ amountCents: 14900 }, 14990, "tenant=t1 checkout Pix")).toBe(14900);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("14900");
    expect(String(warn.mock.calls[0]?.[0])).toContain("14990");
  });

  it("não avisa quando os valores batem", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveInvoiceAmount({ amountCents: 14990 }, 14990, "ctx")).toBe(14990);
    expect(warn).not.toHaveBeenCalled();
  });

  it("cai no preço do plano quando o gateway não informa o valor", () => {
    expect(resolveInvoiceAmount({}, 14990, "ctx")).toBe(14990);
  });
});
