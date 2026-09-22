import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createSupplier, listSuppliers } from "@/modules/catalog";
import { created, handleRoute, ok, parseJsonBody, parseQuery } from "@/lib/http";

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const SupplierInputSchema = z.object({
  name: z.string().min(1),
  cnpj: z.string().optional(),
  contact: z.string().optional(),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:read");
    const filters = parseQuery(new URL(req.url).searchParams, ListQuerySchema);
    return ok(await listSuppliers(ctx.tenantId, filters));
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const input = await parseJsonBody(req, SupplierInputSchema);
    return created(await createSupplier(ctx.tenantId, input));
  });
}
