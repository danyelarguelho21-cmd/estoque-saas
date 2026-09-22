import { requireRole } from "@/modules/auth";
import { getNfeImport } from "@/modules/stock";
import { handleRoute, ok } from "@/lib/http";

export async function GET(_req: Request, ctx: { params: Promise<{ importId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const session = await requireRole("stock:read");
    const { importId } = await ctx.params;
    const result = await getNfeImport(session.tenantId, importId);
    return ok(result);
  });
}
