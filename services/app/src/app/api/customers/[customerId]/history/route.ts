import { requireRole } from "@/modules/auth";
import { getCustomerHistory } from "@/modules/sales";
import { handleRoute, ok } from "@/lib/http";

export async function GET(_req: Request, routeCtx: { params: Promise<{ customerId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:read");
    const { customerId } = await routeCtx.params;
    return ok(await getCustomerHistory(ctx.tenantId, customerId));
  });
}
