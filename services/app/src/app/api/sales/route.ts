import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createSale, listSales } from "@/modules/sales";
import { created, handleRoute, ok, parseJsonBody, parseQuery } from "@/lib/http";

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  storeId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const SaleInputSchema = z.object({
  storeId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  paymentMethodLabel: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid().optional(),
        quantity: z.number().int().min(1),
        unitPriceCents: z.number().int().min(0),
      }),
    )
    .min(1),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const filters = parseQuery(new URL(req.url).searchParams, ListQuerySchema);
    return ok(await listSales(ctx.tenantId, filters));
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:write");
    const input = await parseJsonBody(req, SaleInputSchema);
    const result = await createSale(ctx.tenantId, ctx.userId, input);
    return created(result);
  });
}
