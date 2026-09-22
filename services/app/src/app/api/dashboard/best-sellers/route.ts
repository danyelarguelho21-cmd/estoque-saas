import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { getBestSellers } from "@/modules/sales";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("dashboard:read");
    const query = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await getBestSellers(ctx.tenantId, query));
  });
}
