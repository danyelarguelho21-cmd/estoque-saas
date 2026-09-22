import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { getStockTurnover } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  groupBy: z.enum(["product", "category"]).optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("dashboard:read");
    const query = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await getStockTurnover(ctx.tenantId, query));
  });
}
