import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { linkNfeImportItemToProduct } from "@/modules/stock";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const LinkProductSchema = z.object({ productId: z.string().uuid() });

export async function PATCH(
  req: Request,
  routeCtx: { params: Promise<{ importId: string; itemId: string }> },
): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:write");
    const { importId, itemId } = await routeCtx.params;
    const { productId } = await parseJsonBody(req, LinkProductSchema);
    await linkNfeImportItemToProduct(ctx.tenantId, importId, itemId, productId);
    return ok({ status: "linked" });
  });
}
