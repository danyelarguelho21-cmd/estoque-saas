import { z } from "zod";

// Endereço de cobrança do tenant — exigido pelo gateway Pix da Vindi (sem ele a transação Pix é
// recusada e a fatura fica sem QR Code). Usado no cadastro (/cadastro), no formulário de
// /assinatura para tenants antigos e no backend (SignupSchema, PUT /api/tenant/billing-address):
// o mesmo schema no front e no back, para as mensagens nunca divergirem.

export const BRAZIL_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type BrazilUf = (typeof BRAZIL_UFS)[number];

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function zipcodeMask(value: string): string {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

const requiredText = (message: string, max: number) =>
  z.string({ required_error: message }).trim().min(1, message).max(max, `Use no máximo ${max} caracteres.`);

export const BillingAddressSchema = z.object({
  zipcode: z
    .string({ required_error: "Informe o CEP." })
    .transform(onlyDigits)
    .refine((value) => value.length === 8, { message: "CEP deve ter 8 dígitos." }),
  street: requiredText("Informe a rua.", 120),
  number: requiredText("Informe o número.", 20),
  complement: z.string().trim().max(60, "Use no máximo 60 caracteres.").optional().nullable()
    .transform((value) => value || null),
  neighborhood: z.string().trim().max(60, "Use no máximo 60 caracteres.").optional().nullable()
    .transform((value) => value || null),
  city: requiredText("Informe a cidade.", 60),
  state: z
    .string({ required_error: "Informe a UF." })
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value): value is BrazilUf => (BRAZIL_UFS as readonly string[]).includes(value), {
      message: "UF inválida.",
    }),
});

export type BillingAddressInput = z.input<typeof BillingAddressSchema>;
export type BillingAddress = z.output<typeof BillingAddressSchema>;

export const EMPTY_BILLING_ADDRESS: BillingAddressInput = {
  zipcode: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

// Valida no front e devolve a primeira mensagem de erro por campo (para exibir sob cada input).
export function validateBillingAddress(
  input: BillingAddressInput,
): { ok: true; data: BillingAddress } | { ok: false; errors: Partial<Record<keyof BillingAddressInput, string>> } {
  const parsed = BillingAddressSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Partial<Record<keyof BillingAddressInput, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof BillingAddressInput | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

export interface ViaCepResult {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

// Consulta o ViaCEP direto do navegador. Nunca lança: qualquer falha (rede, CEP inexistente,
// timeout) devolve null e o formulário segue editável manualmente.
export async function lookupCep(zipcode: string, signal?: AbortSignal): Promise<ViaCepResult | null> {
  const digits = onlyDigits(zipcode);
  if (digits.length !== 8) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { erro?: unknown; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (body.erro) return null;
    return {
      street: body.logradouro ?? "",
      neighborhood: body.bairro ?? "",
      city: body.localidade ?? "",
      state: body.uf ?? "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
