import { z } from "zod";
import { signupTenant } from "@/modules/auth";
import { created, handleRoute, parseJsonBody } from "@/lib/http";
import { isValidCnpj, isValidCpf } from "@/lib/format";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";

// Suporte a pessoa física (CPF) além de pessoa jurídica (CNPJ) — pequeno empreendedor sem CNPJ
// também pode assinar. `personType` decide qual documento é validado/obrigatório; discriminated
// union em vez de dois campos opcionais soltos evita o caso "nenhum documento preenchido" ou "os
// dois preenchidos" passar despercebido — mesma postura fail-closed de requireSession/requireRole.
const SignupSchema = z.discriminatedUnion("personType", [
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
  }),
  z.object({
    personType: z.literal("PF"),
    companyName: z.string().min(1),
    cpf: z.string().min(1).refine(isValidCpf, { message: "CPF inválido." }),
    adminName: z.string().min(1),
    adminEmail: z.string().email(),
    password: z.string().min(8),
    planId: z.string().uuid(),
  }),
]);

// security-engineer finding H-5: endpoint público, sem sessão, cria um tenant INTEIRO por
// chamada — sem limite, exposto a criação em massa de tenants falsos (resource exhaustion, spam,
// abuso de limites de plano). Janela mais larga que login (criar conta é uma ação rara e
// deliberada, não algo que um usuário legítimo faz repetidamente em minutos).
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ip = clientIp(req);
    await checkRateLimit({ key: `rl:signup:ip:${ip}`, ...RATE_LIMITS.signupByIp });
    const input = await parseJsonBody(req, SignupSchema);
    const result = await signupTenant({
      companyName: input.companyName,
      personType: input.personType,
      cnpj: input.personType === "PJ" ? input.cnpj : null,
      cpf: input.personType === "PF" ? input.cpf : null,
      adminName: input.adminName,
      adminEmail: input.adminEmail,
      password: input.password,
      planId: input.planId,
    });
    return created(result);
  });
}
