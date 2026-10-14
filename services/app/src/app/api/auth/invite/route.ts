import { getInviteInfo } from "@/modules/auth";
import { handleRoute, ok } from "@/lib/http";
import { ValidationError } from "@estoque-saas/shared";

// Público (prefixo /api/auth): dados do convite para a tela de aceite (/convite?token=...).
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) throw new ValidationError("Convite inválido.");
    return ok(await getInviteInfo(token));
  });
}
