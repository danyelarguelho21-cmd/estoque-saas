import { z } from "zod";
import { listUsers, requireRole } from "@/modules/auth";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("users:manage");
    const filters = parseQuery(new URL(req.url).searchParams, ListQuerySchema);
    return ok(await listUsers(ctx.tenantId, filters));
  });
}
