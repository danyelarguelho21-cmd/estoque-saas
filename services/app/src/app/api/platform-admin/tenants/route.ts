import { z } from "zod";
import { listTenantsAdmin, requirePlatformAdmin } from "@/modules/admin";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  subscriptionStatus: z.enum(["trialing", "active", "past_due", "canceled"]).optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const filters = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await listTenantsAdmin(filters));
  });
}
