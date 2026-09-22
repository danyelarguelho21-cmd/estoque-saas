import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/index";
import { MAX_CSV_UPLOAD_BYTES, MAX_NFE_UPLOAD_BYTES, assertUploadSizeWithinLimit } from "./index";

// security-engineer finding H-3 (Wave B): /api/nfe-imports e /api/products/import não tinham
// nenhum limite de tamanho de upload — um único tenant podia enviar um arquivo arbitrariamente
// grande e esgotar CPU/memória do worker compartilhado (BullMQ, ADR-001), afetando billing/alertas
// de TODOS os outros tenants (Denial of Service). Este teste é a regressão para o fix.
describe("assertUploadSizeWithinLimit", () => {
  it("allows a file within the limit", () => {
    expect(() => assertUploadSizeWithinLimit(1024, MAX_NFE_UPLOAD_BYTES)).not.toThrow();
  });

  it("allows a file exactly at the limit", () => {
    expect(() => assertUploadSizeWithinLimit(MAX_NFE_UPLOAD_BYTES, MAX_NFE_UPLOAD_BYTES)).not.toThrow();
  });

  it("rejects a file one byte over the limit with a ValidationError (400)", () => {
    expect(() => assertUploadSizeWithinLimit(MAX_NFE_UPLOAD_BYTES + 1, MAX_NFE_UPLOAD_BYTES)).toThrow(ValidationError);
  });

  it("rejects a large NF-e XML upload (simulated 500MB entity-expansion-style payload)", () => {
    const hugeFile = 500 * 1024 * 1024;
    expect(() => assertUploadSizeWithinLimit(hugeFile, MAX_NFE_UPLOAD_BYTES)).toThrow(ValidationError);
  });

  it("rejects a CSV upload over its own (larger) limit", () => {
    expect(() => assertUploadSizeWithinLimit(MAX_CSV_UPLOAD_BYTES + 1, MAX_CSV_UPLOAD_BYTES)).toThrow(ValidationError);
  });

  it("never leaks a stack trace — the thrown error carries a safe, user-facing message", () => {
    try {
      assertUploadSizeWithinLimit(MAX_NFE_UPLOAD_BYTES * 2, MAX_NFE_UPLOAD_BYTES);
      throw new Error("expected assertUploadSizeWithinLimit to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toMatch(/tamanho máximo/);
    }
  });
});
