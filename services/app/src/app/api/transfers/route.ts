import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createTransfer } from "@/modules/stock";
import { created, handleRoute, parseJsonBody } from "@/lib/http";

const TransferSchema = z.object({
  originStoreId: z.string().uuid(),
  destinationStoreId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        batchId: z.string().uuid().optional(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1),
});

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:write");
    const input = await parseJsonBody(req, TransferSchema);
    const result = await createTransfer(ctx.tenantId, ctx.userId, input);
    return created(result);
  });
}
