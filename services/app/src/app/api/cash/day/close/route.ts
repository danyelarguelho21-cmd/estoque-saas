import { z } from "zod";
import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { closeDayCash, hideCost } from "@/modules/sales";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const CloseSchema = z.object({
  storeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
});

// Fechar o caixa do dia — qualquer papel que registra venda (inclusive vendedor).
// Fechar de novo o mesmo dia atualiza o fechamento (ex.: entrou venda depois).
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:write");
    const input = await parseJsonBody(req, CloseSchema);
    const day = await closeDayCash(ctx.tenantId, ctx.userId, input);
    return ok(hideCost(day, await hasFinancialAccess(ctx)));
  });
}
