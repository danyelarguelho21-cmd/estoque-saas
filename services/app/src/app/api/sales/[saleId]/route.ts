import { NotFoundError } from "@estoque-saas/shared";
import { requireRole } from "@/modules/auth";
import { getSale } from "@/modules/sales";
import { handleRoute, ok } from "@/lib/http";

export async function GET(_req: Request, routeCtx: { params: Promise<{ saleId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { saleId } = await routeCtx.params;
    const sale = await getSale(ctx.tenantId, saleId);
    if (!sale) throw new NotFoundError("Venda não encontrada.");
    return ok(sale);
  });
}
