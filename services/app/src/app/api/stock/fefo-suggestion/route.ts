import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { suggestFefoBatches } from "@/modules/stock";
import { withTenant } from "@estoque-saas/shared";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({
  productId: z.string().uuid(),
  storeId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1),
});

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:read");
    const { searchParams } = new URL(req.url);
    const input = parseQuery(searchParams, QuerySchema);

    const batches = await withTenant(ctx.tenantId, (tx) =>
      tx.batch.findMany({
        where: { productId: input.productId, storeId: input.storeId, quantity: { gt: 0 } },
        orderBy: { expiryDate: "asc" },
      }),
    );

    const result = suggestFefoBatches(
      batches.map((b) => ({ batchId: b.id, expiryDate: b.expiryDate.toISOString().slice(0, 10), quantity: b.quantity })),
      input.quantity,
    );

    return ok(result);
  });
}
