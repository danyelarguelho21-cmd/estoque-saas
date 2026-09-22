import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createProduct, listProducts } from "@/modules/catalog";
import { created, handleRoute, ok, parseJsonBody, parseQuery } from "@/lib/http";

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  belowMinStock: z.coerce.boolean().optional(),
  storeId: z.string().uuid().optional(),
});

const ProductInputSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  categoryId: z.string().uuid().optional(),
  unitOfMeasure: z.string().min(1),
  barcode: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  isPerishable: z.boolean().optional(),
  minStockGlobal: z.number().int().min(0).optional(),
  costPriceCents: z.number().int().min(0).optional(),
  salePriceCents: z.number().int().min(0).optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:read");
    const filters = parseQuery(new URL(req.url).searchParams, ListQuerySchema);
    const result = await listProducts(ctx.tenantId, filters);
    return ok(result);
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const input = await parseJsonBody(req, ProductInputSchema);
    const result = await createProduct(ctx.tenantId, ctx.userId, input);
    return created(result);
  });
}
