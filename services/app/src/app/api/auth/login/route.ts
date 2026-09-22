import { z } from "zod";
import { AuthError } from "next-auth";
import { signIn } from "@/modules/auth";
import { UnauthorizedError } from "@estoque-saas/shared";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// security-engineer finding H-5: sem rate limit, /api/auth/login era exposto a credential
// stuffing / força bruta sem qualquer fricção. Dois buckets independentes — por IP (pega um
// atacante rotacionando e-mails contra o mesmo IP) e por e-mail (pega um atacante rotacionando
// IPs/proxies contra uma conta específica) — o mais restritivo dos dois vence.
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ip = clientIp(req);
    await checkRateLimit({ key: `rl:login:ip:${ip}`, ...RATE_LIMITS.loginByIp });
    const input = await parseJsonBody(req, LoginSchema);
    await checkRateLimit({ key: `rl:login:email:${input.email.toLowerCase()}`, ...RATE_LIMITS.loginByEmail });
    try {
      // redirect:false — Route Handler devolve JSON, não um redirect de página (contrato da API).
      await signIn("credentials", { ...input, redirect: false });
    } catch (err) {
      if (err instanceof AuthError) {
        throw new UnauthorizedError("E-mail ou senha inválidos.");
      }
      throw err;
    }
    return ok({ status: "ok" });
  });
}
