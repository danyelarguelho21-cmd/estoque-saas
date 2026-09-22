import { z } from "zod";
import { createStore, listStores, requireRole } from "@/modules/auth";
import { created, handleRoute, ok, parseJsonBody, parseQuery } from "@/lib/http";

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const StoreInputSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["loja", "deposito"]),
  address: z.string().optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:read");
    const filters = parseQuery(new URL(req.url).searchParams, ListQuerySchema);
    return ok(await listStores(ctx.tenantId, filters));
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("tenant:manage");
    const input = await parseJsonBody(req, StoreInputSchema);
    return created(await createStore(ctx.tenantId, ctx.userId, input));
  });
}
