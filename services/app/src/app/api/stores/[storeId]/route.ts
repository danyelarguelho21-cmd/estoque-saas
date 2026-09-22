import { z } from "zod";
import { requireRole, updateStore } from "@/modules/auth";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const StoreUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["loja", "deposito"]).optional(),
  address: z.string().optional(),
});

export async function PATCH(req: Request, routeCtx: { params: Promise<{ storeId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("tenant:manage");
    const { storeId } = await routeCtx.params;
    const input = await parseJsonBody(req, StoreUpdateSchema);
    return ok(await updateStore(ctx.tenantId, ctx.userId, storeId, input));
  });
}
