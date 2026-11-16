import { z } from "zod";
import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { hideCost, listCashClosings } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Últimos caixas fechados. Custo/lucro só para quem tem acesso financeiro.
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { storeId, limit } = parseQuery(new URL(req.url).searchParams, QuerySchema);
    const financial = await hasFinancialAccess(ctx);
    const closings = await listCashClosings(ctx.tenantId, { storeId, limit });
    return ok(closings.map((c) => hideCost(c, financial)));
  });
}
