import { z } from "zod";
import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { listOpenCashSessions, openCashSession, toCashSessionView } from "@/modules/sales";
import { created, handleRoute, ok, parseJsonBody, parseQuery } from "@/lib/http";

const ListQuerySchema = z.object({ storeId: z.string().uuid().optional() });
const OpenSchema = z.object({
  storeId: z.string().uuid(),
  openingAmountCents: z.number().int().min(0).max(100_000_000),
});

// Caixas abertos (para a tela Caixa saber se a loja já tem caixa aberto).
export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { storeId } = parseQuery(new URL(req.url).searchParams, ListQuerySchema);
    return ok(await listOpenCashSessions(ctx.tenantId, storeId));
  });
}

// Abrir caixa — qualquer papel que registra venda (inclusive vendedor).
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:write");
    const input = await parseJsonBody(req, OpenSchema);
    const detail = await openCashSession(ctx.tenantId, ctx.userId, input);
    return created(toCashSessionView(detail, await hasFinancialAccess(ctx)));
  });
}
