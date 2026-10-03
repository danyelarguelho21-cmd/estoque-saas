import { z } from "zod";
import { BillingAddressSchema } from "@/lib/billing-address";
import { isValidCnpj, isValidCpf } from "@/lib/format";

// Fora de api/auth/signup/route.ts porque arquivos de rota do App Router só podem exportar
// handlers HTTP/config — aqui o schema pode ser importado pelos testes de validação.
//
// Suporte a pessoa física (CPF) além de pessoa jurídica (CNPJ) — pequeno empreendedor sem CNPJ
// também pode assinar. `personType` decide qual documento é validado/obrigatório; discriminated
// union em vez de dois campos opcionais soltos evita o caso "nenhum documento preenchido" ou "os
// dois preenchidos" passar despercebido — mesma postura fail-closed de requireSession/requireRole.
//
// billingAddress é obrigatório: o gateway Pix da Vindi recusa a transação de cliente sem endereço.
export const SignupSchema = z.discriminatedUnion("personType", [
  z.object({
    personType: z.literal("PJ"),
    companyName: z.string().min(1),
    // Reforço de defesa em profundidade: o formulário (services/app/src/app/cadastro/page.tsx) já
    // valida o dígito verificador antes de enviar, mas esta rota é pública e pode ser chamada
    // diretamente (sem passar pelo form) — sem isto, um documento com dígito errado só falharia
    // dias depois, no worker, quando o PagBank rejeitasse a primeira cobrança.
    cnpj: z.string().min(1).refine(isValidCnpj, { message: "CNPJ inválido." }),
    adminName: z.string().min(1),
    adminEmail: z.string().email(),
    password: z.string().min(8),
    planId: z.string().uuid(),
    billingAddress: BillingAddressSchema,
  }),
  z.object({
    personType: z.literal("PF"),
    companyName: z.string().min(1),
    cpf: z.string().min(1).refine(isValidCpf, { message: "CPF inválido." }),
    adminName: z.string().min(1),
    adminEmail: z.string().email(),
    password: z.string().min(8),
    planId: z.string().uuid(),
    billingAddress: BillingAddressSchema,
  }),
]);

export type SignupPayload = z.output<typeof SignupSchema>;
