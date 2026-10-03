import { signupTenant } from "@/modules/auth";
import { created, handleRoute, parseJsonBody } from "@/lib/http";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";
import { SignupSchema } from "@/lib/signup-schema";

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
      billingAddress: input.billingAddress,
    });
    return created(result);
  });
}
