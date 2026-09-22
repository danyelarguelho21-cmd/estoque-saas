import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { listStockMovements } from "@/modules/stock";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  storeId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  type: z.string().optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:read");
    const { searchParams } = new URL(req.url);
    const filters = parseQuery(searchParams, QuerySchema);
    const result = await listStockMovements(ctx.tenantId, filters);
    return ok(result);
  });
}
