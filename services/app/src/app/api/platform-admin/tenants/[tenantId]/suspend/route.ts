import { requirePlatformAdmin, suspendTenant } from "@/modules/admin";
import { handleRoute, ok } from "@/lib/http";

export async function POST(_req: Request, routeCtx: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const { tenantId } = await routeCtx.params;
    return ok(await suspendTenant(tenantId));
  });
}
