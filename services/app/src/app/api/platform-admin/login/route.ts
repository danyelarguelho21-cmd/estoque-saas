import { z } from "zod";
import { platformAdminLogin } from "@/modules/admin";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// security-engineer finding H-5: /api/platform-admin/login é a credencial de MAIOR raio de
// explosão do sistema (visibilidade de todos os tenants + poder de suspender/reativar qualquer
// um) — política estritamente mais restritiva que o login de tenant, nunca igual ou mais fraca.
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ip = clientIp(req);
    await checkRateLimit({ key: `rl:admin-login:ip:${ip}`, ...RATE_LIMITS.adminLoginByIp });
    const input = await parseJsonBody(req, LoginSchema);
    await checkRateLimit({ key: `rl:admin-login:email:${input.email.toLowerCase()}`, ...RATE_LIMITS.adminLoginByEmail });
    await platformAdminLogin(input.email, input.password);
    return ok({ status: "ok" });
  });
}
