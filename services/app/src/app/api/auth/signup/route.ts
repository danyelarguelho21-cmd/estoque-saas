import { z } from "zod";
import { signupTenant } from "@/modules/auth";
import { created, handleRoute, parseJsonBody } from "@/lib/http";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";

const SignupSchema = z.object({
  companyName: z.string().min(1),
  cnpj: z.string().min(1),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  password: z.string().min(8),
  planId: z.string().uuid(),
});

// security-engineer finding H-5: endpoint público, sem sessão, cria um tenant INTEIRO por
// chamada — sem limite, exposto a criação em massa de tenants falsos (resource exhaustion, spam,
// abuso de limites de plano). Janela mais larga que login (criar conta é uma ação rara e
// deliberada, não algo que um usuário legítimo faz repetidamente em minutos).
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ip = clientIp(req);
    await checkRateLimit({ key: `rl:signup:ip:${ip}`, ...RATE_LIMITS.signupByIp });
    const input = await parseJsonBody(req, SignupSchema);
    const result = await signupTenant(input);
    return created(result);
  });
}
