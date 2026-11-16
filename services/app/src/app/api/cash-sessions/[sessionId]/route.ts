import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { getCashSession, toCashSessionView } from "@/modules/sales";
import { handleRoute, ok } from "@/lib/http";

// Detalhe do caixa. Sem acesso financeiro (vendedor sem a senha do gestor) o esperado, a diferença
// e as vendas do período não são enviados — fechamento cego.
export async function GET(_req: Request, routeCtx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { sessionId } = await routeCtx.params;
    const detail = await getCashSession(ctx.tenantId, sessionId);
    return ok(toCashSessionView(detail, await hasFinancialAccess(ctx)));
  });
}
