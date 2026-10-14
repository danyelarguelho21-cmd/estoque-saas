import { z } from "zod";
import { acceptInvite } from "@/modules/auth";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const AcceptSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

// Público (prefixo /api/auth): o convidado define a senha e ativa o acesso.
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    await checkRateLimit({ key: `rl:invite-accept:ip:${clientIp(req)}`, limit: 10, windowMs: 15 * 60_000 });
    const input = await parseJsonBody(req, AcceptSchema);
    return ok(await acceptInvite(input.token, input.password));
  });
}
