// isValidCnpj — achado ao vivo (24/09/2026): o formulário de cadastro só mascarava o CNPJ
// (cnpjMask), sem validar o dígito verificador. Um CNPJ com dígito errado passava no cadastro
// sem aviso e só ia falhar dias depois, no worker, quando o PagBank rejeitasse a cobrança com
// "customer.tax_id must be a valid CPF or CNPJ" — tarde demais para o lojista corrigir na hora.
import { describe, expect, it } from "vitest";
import { isValidCnpj } from "@/lib/format";

describe("isValidCnpj", () => {
  it("aceita um CNPJ com dígito verificador correto, formatado", () => {
    // Confirmado contra o PagBank sandbox real: gerou fatura Pix com sucesso.
    expect(isValidCnpj("10.433.218/0001-93")).toBe(true);
  });

  it("aceita o mesmo CNPJ só com dígitos, sem máscara", () => {
    expect(isValidCnpj("10433218000193")).toBe(true);
  });

  it("rejeita um CNPJ com dígito verificador errado", () => {
    // Este exato valor foi usado num teste manual e o PagBank sandbox devolveu 400:
    // "must be a valid CPF or CNPJ" — confirma que o dígito verificador está mesmo errado.
    expect(isValidCnpj("12.345.678/0001-99")).toBe(false);
  });

  it("rejeita CNPJ com todos os dígitos iguais", () => {
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });

  it("rejeita string com número errado de dígitos", () => {
    expect(isValidCnpj("123")).toBe(false);
    expect(isValidCnpj("10.433.218/0001-930")).toBe(false);
  });

  it("rejeita string vazia ou não numérica", () => {
    expect(isValidCnpj("")).toBe(false);
    expect(isValidCnpj("abc.def.ghi/jklm-no")).toBe(false);
  });
});
