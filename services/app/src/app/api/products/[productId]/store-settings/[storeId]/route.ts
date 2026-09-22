import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { setProductStoreMinStock } from "@/modules/catalog";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const BodySchema = z.object({ minStockOverride: z.number().int().min(0).nullable().optional() });

export async function PUT(
  req: Request,
  routeCtx: { params: Promise<{ productId: string; storeId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const { productId, storeId } = await routeCtx.params;
    const body = await parseJsonBody(req, BodySchema);
    const result = await setProductStoreMinStock(ctx.tenantId, productId, storeId, body.minStockOverride ?? null);
    return ok(result);
  });
}
