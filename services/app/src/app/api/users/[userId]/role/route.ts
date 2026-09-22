import { z } from "zod";
import { ROLES } from "@estoque-saas/shared";
import { requireRole, updateUserRole } from "@/modules/auth";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const BodySchema = z.object({ role: z.enum(ROLES) });

export async function PATCH(req: Request, routeCtx: { params: Promise<{ userId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("users:manage");
    const { userId } = await routeCtx.params;
    const { role } = await parseJsonBody(req, BodySchema);
    return ok(await updateUserRole(ctx.tenantId, ctx.userId, userId, role));
  });
}
