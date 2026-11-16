import { z } from "zod";
import { requireFinancialAccess } from "@/modules/auth";
import { listClosedCashSessions } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Histórico de caixas fechados (com esperado e diferença) — só admin/operador ou senha do gestor.
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireFinancialAccess();
    const filters = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await listClosedCashSessions(ctx.tenantId, filters));
  });
}
