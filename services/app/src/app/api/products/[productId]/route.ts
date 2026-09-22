import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { deleteProduct, getProduct, updateProduct } from "@/modules/catalog";
import { handleRoute, noContent, ok, parseJsonBody } from "@/lib/http";

const ProductUpdateSchema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  categoryId: z.string().uuid().optional(),
  unitOfMeasure: z.string().min(1).optional(),
  barcode: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  isPerishable: z.boolean().optional(),
  minStockGlobal: z.number().int().min(0).optional(),
  costPriceCents: z.number().int().min(0).optional(),
  salePriceCents: z.number().int().min(0).optional(),
});

type RouteCtx = { params: Promise<{ productId: string }> };

export async function GET(_req: Request, routeCtx: RouteCtx): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:read");
    const { productId } = await routeCtx.params;
    const result = await getProduct(ctx.tenantId, productId);
    return ok(result);
  });
}

export async function PATCH(req: Request, routeCtx: RouteCtx): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const { productId } = await routeCtx.params;
    const input = await parseJsonBody(req, ProductUpdateSchema);
    const result = await updateProduct(ctx.tenantId, ctx.userId, productId, input);
    return ok(result);
  });
}

export async function DELETE(_req: Request, routeCtx: RouteCtx): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const { productId } = await routeCtx.params;
    await deleteProduct(ctx.tenantId, ctx.userId, productId);
    return noContent();
  });
}
