import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { confirmNfeImport } from "@/modules/stock";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const ConfirmSchema = z.object({
  items: z
    .array(
      z.object({
        nfeImportItemId: z.string().uuid(),
        batchNumber: z.string().optional(),
        expiryDate: z.string().optional(),
      }),
    )
    .optional(),
});

export async function POST(req: Request, routeCtx: { params: Promise<{ importId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("stock:write");
    const { importId } = await routeCtx.params;
    const input = await parseJsonBody(req, ConfirmSchema);
    await confirmNfeImport(ctx.tenantId, ctx.userId, importId, input.items ?? []);
    return ok({ status: "confirmed" });
  });
}
