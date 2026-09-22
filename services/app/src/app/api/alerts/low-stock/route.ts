import { requireRole } from "@/modules/auth";
import { listLowStockAlerts } from "@/modules/stock";
import { handleRoute, ok } from "@/lib/http";

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:read");
    const storeId = new URL(req.url).searchParams.get("storeId") ?? undefined;
    const result = await listLowStockAlerts(ctx.tenantId, storeId);
    return ok(result);
  });
}
