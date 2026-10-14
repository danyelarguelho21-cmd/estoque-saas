import { requireRole, resendInvite } from "@/modules/auth";
import { handleRoute, ok } from "@/lib/http";
import { publicBaseUrl } from "@/lib/public-url";

export async function POST(req: Request, routeCtx: { params: Promise<{ userId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("users:manage");
    const { userId } = await routeCtx.params;
    return ok(await resendInvite(ctx.tenantId, userId, { baseUrl: publicBaseUrl(req) }));
  });
}
