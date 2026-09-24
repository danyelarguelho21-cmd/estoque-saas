import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { prepareProductLabels } from "@/modules/catalog";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const InputSchema = z.object({ productIds: z.array(z.string().uuid()).min(1).max(100) });

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("catalog:write");
    const { productIds } = await parseJsonBody(req, InputSchema);
    return ok(await prepareProductLabels(ctx.tenantId, [...new Set(productIds)]));
  });
}
