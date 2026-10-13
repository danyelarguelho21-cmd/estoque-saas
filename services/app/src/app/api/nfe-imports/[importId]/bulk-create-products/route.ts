import { requireRole } from "@/modules/auth";
import { bulkCreateProductsFromNfeImport } from "@/modules/stock";
import { handleRoute, ok } from "@/lib/http";

// Cadastra de uma vez todos os itens "não reconhecidos" da conferência de NF-e.
export async function POST(_req: Request, routeCtx: { params: Promise<{ importId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    await requireRole("catalog:write");
    const ctx = await requireRole("stock:write");
    const { importId } = await routeCtx.params;
    const result = await bulkCreateProductsFromNfeImport(ctx.tenantId, ctx.userId, importId);
    return ok(result);
  });
}
