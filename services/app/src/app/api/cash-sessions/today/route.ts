import { z } from "zod";
import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { getTodayCashStatus } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({ storeId: z.string().uuid().optional() });

// Situação do caixa de hoje por loja (card do Painel). A diferença só vai para quem tem acesso
// financeiro; os demais veem apenas se está aberto/fechado.
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { storeId } = parseQuery(new URL(req.url).searchParams, QuerySchema);
    const status = await getTodayCashStatus(ctx.tenantId, storeId);
    const financial = await hasFinancialAccess(ctx);
    return ok(financial ? status : status.map((s) => ({ ...s, cashDifferenceCents: null, totalDifferenceCents: null })));
  });
}
