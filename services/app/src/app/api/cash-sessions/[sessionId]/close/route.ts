import { z } from "zod";
import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { closeCashSession, toCashSessionView } from "@/modules/sales";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const cents = z.number().int().min(0).max(100_000_000);
const CloseSchema = z.object({
  countedCashCents: cents,
  countedPixCents: cents.optional(),
  countedDebitCents: cents.optional(),
  countedCreditCents: cents.optional(),
  notes: z.string().max(500).optional(),
});

// Fechar caixa. O vendedor sem a senha do gestor recebe só a confirmação (fechamento cego).
export async function POST(req: Request, routeCtx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:write");
    const { sessionId } = await routeCtx.params;
    const input = await parseJsonBody(req, CloseSchema);
    const detail = await closeCashSession(ctx.tenantId, ctx.userId, sessionId, input);
    return ok(toCashSessionView(detail, await hasFinancialAccess(ctx)));
  });
}
