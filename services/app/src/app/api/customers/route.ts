import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createCustomer, listCustomers } from "@/modules/sales";
import { created, handleRoute, ok, parseJsonBody, parseQuery } from "@/lib/http";

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
});

const CustomerInputSchema = z.object({
  name: z.string().min(1),
  document: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const filters = parseQuery(new URL(req.url).searchParams, ListQuerySchema);
    return ok(await listCustomers(ctx.tenantId, filters));
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:write");
    const input = await parseJsonBody(req, CustomerInputSchema);
    return created(await createCustomer(ctx.tenantId, input));
  });
}
