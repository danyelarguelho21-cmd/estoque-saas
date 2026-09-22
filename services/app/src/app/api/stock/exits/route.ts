import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createStockExit } from "@/modules/stock";
import { created, handleRoute, parseJsonBody } from "@/lib/http";

const StockExitSchema = z.object({
  productId: z.string().uuid(),
  storeId: z.string().uuid(),
  quantity: z.number().int().min(1),
  type: z.enum(["saida_perda", "ajuste"]),
  reason: z.string().optional(),
  batchId: z.string().uuid().optional(),
});

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:write");
    const input = await parseJsonBody(req, StockExitSchema);
    const result = await createStockExit(ctx.tenantId, ctx.userId, input);
    return created(result);
  });
}
