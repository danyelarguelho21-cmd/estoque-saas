import { requireRole } from "@/modules/auth";
import { listProductStoreSettings } from "@/modules/catalog";
import { handleRoute, ok } from "@/lib/http";

// Mínimos por loja já salvos para o produto (para pré-preencher a tela de edição).
export async function GET(_req: Request, routeCtx: { params: Promise<{ productId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:read");
    const { productId } = await routeCtx.params;
    return ok(await listProductStoreSettings(ctx.tenantId, productId));
  });
}
