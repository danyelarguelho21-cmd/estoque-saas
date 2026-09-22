import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { getStalledProducts } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(1).optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("dashboard:read");
    const query = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await getStalledProducts(ctx.tenantId, query));
  });
}
