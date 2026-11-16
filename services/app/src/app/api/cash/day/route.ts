import { z } from "zod";
import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { getDayCash, hideCost } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  storeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Caixa do dia de uma loja (padrão: hoje). Custo/lucro só para quem tem acesso financeiro.
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { storeId, date } = parseQuery(new URL(req.url).searchParams, QuerySchema);
    const day = await getDayCash(ctx.tenantId, storeId, date);
    return ok(hideCost(day, await hasFinancialAccess(ctx)));
  });
}
