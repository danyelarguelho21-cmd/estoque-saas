import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createManualEntry } from "@/modules/stock";
import { created, handleRoute, parseJsonBody } from "@/lib/http";

const ManualEntrySchema = z.object({
  productId: z.string().uuid(),
  storeId: z.string().uuid(),
  quantity: z.number().int().min(1),
  unitCostCents: z.number().int().min(0).optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:write");
    const input = await parseJsonBody(req, ManualEntrySchema);
    const result = await createManualEntry(ctx.tenantId, ctx.userId, input);
    return created(result);
  });
}
