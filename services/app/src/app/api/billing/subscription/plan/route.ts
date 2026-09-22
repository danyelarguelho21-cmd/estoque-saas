import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { changePlan } from "@/modules/billing";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

export async function PATCH(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("billing:manage");
    const { planId } = await parseJsonBody(req, z.object({ planId: z.string().uuid() }));
    return ok(await changePlan(ctx.tenantId, planId));
  });
}
