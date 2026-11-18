import { ForbiddenError, NotFoundError } from "@estoque-saas/shared";
import { hasFinancialAccess, requireRole } from "@/modules/auth";
import { deleteSale, getSale } from "@/modules/sales";
import { handleRoute, noContent, ok } from "@/lib/http";

export async function GET(_req: Request, routeCtx: { params: Promise<{ saleId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { saleId } = await routeCtx.params;
    const sale = await getSale(ctx.tenantId, saleId);
    if (!sale) throw new NotFoundError("Venda não encontrada.");
    return ok(sale);
  });
}

// Apagar venda: admin/operador direto; vendedor só com a senha do gestor liberada.
// Os produtos voltam para o estoque e a venda sai do caixa do dia.
export async function DELETE(_req: Request, routeCtx: { params: Promise<{ saleId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:write");
    if (!(await hasFinancialAccess(ctx))) {
      throw new ForbiddenError("Para apagar uma venda, digite a senha do gestor.");
    }
    const { saleId } = await routeCtx.params;
    await deleteSale(ctx.tenantId, ctx.userId, saleId);
    return noContent();
  });
}
