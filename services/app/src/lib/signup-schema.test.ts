import { describe, expect, it } from "vitest";
import { BRAZIL_UFS, BillingAddressSchema } from "./billing-address";
import { SignupSchema } from "./signup-schema";

const billingAddress = {
  zipcode: "01310-100",
  street: "Avenida Paulista",
  number: "1000",
  complement: "",
  neighborhood: "Bela Vista",
  city: "São Paulo",
  state: "sp",
};

const pj = {
  personType: "PJ" as const,
  companyName: "Loja Teste",
  cnpj: "11.222.333/0001-81",
  adminName: "Ana",
  adminEmail: "ana@example.com",
  password: "senha-segura",
  planId: "6f1c1d5e-2b7a-4c39-9b8e-0f6f2c1a9d11",
  billingAddress,
};

function without<T extends object>(value: T, ...keys: (keyof T)[]): Partial<T> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

function issuesFor(input: unknown): Record<string, string> {
  const parsed = SignupSchema.safeParse(input);
  if (parsed.success) return {};
  return Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("SignupSchema — endereço de cobrança", () => {
  it("aceita PJ e PF com endereço válido e normaliza CEP, UF e complemento vazio", () => {
    const parsed = SignupSchema.parse(pj);
    expect(parsed.billingAddress).toEqual({
      zipcode: "01310100",
      street: "Avenida Paulista",
      number: "1000",
      complement: null,
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    });

    expect(SignupSchema.safeParse({ ...without(pj, "cnpj"), personType: "PF", cpf: "529.982.247-25" }).success).toBe(true);
  });

  it("exige o endereço de cobrança no cadastro", () => {
    expect(issuesFor(without(pj, "billingAddress"))).toHaveProperty("billingAddress");
  });

  it("rejeita CEP sem 8 dígitos com mensagem em português", () => {
    expect(issuesFor({ ...pj, billingAddress: { ...billingAddress, zipcode: "1310-100" } })).toEqual({
      "billingAddress.zipcode": "CEP deve ter 8 dígitos.",
    });
    expect(issuesFor({ ...pj, billingAddress: { ...billingAddress, zipcode: "013101000" } })).toHaveProperty("billingAddress.zipcode");
  });

  it("aceita só as 27 UFs válidas", () => {
    expect(BRAZIL_UFS).toHaveLength(27);
    for (const uf of BRAZIL_UFS) {
      expect(BillingAddressSchema.safeParse({ ...billingAddress, state: uf }).success).toBe(true);
    }
    expect(issuesFor({ ...pj, billingAddress: { ...billingAddress, state: "XX" } })).toEqual({ "billingAddress.state": "UF inválida." });
    expect(issuesFor({ ...pj, billingAddress: { ...billingAddress, state: "" } })).toEqual({ "billingAddress.state": "UF inválida." });
  });

  it("exige rua, número e cidade (espaços em branco não contam)", () => {
    expect(issuesFor({ ...pj, billingAddress: { ...billingAddress, street: "  ", number: "", city: "" } })).toEqual({
      "billingAddress.street": "Informe a rua.",
      "billingAddress.number": "Informe o número.",
      "billingAddress.city": "Informe a cidade.",
    });
  });

  it("mantém complemento e bairro opcionais", () => {
    const parsed = BillingAddressSchema.parse(without(billingAddress, "complement", "neighborhood"));
    expect(parsed.complement).toBeNull();
    expect(parsed.neighborhood).toBeNull();
  });

  it("continua validando o documento junto com o endereço", () => {
    expect(issuesFor({ ...pj, cnpj: "11.222.333/0001-82" })).toEqual({ cnpj: "CNPJ inválido." });
  });
});
