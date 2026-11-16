import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { listPendingCashDays } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({ storeId: z.string().uuid().optional() });

// Dias anteriores com venda e caixa não fechado (aviso "você não fechou o caixa").
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { storeId } = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await listPendingCashDays(ctx.tenantId, storeId));
  });
}
