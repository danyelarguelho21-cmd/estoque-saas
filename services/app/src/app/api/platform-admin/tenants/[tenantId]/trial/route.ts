import { z } from "zod";
import { endTrial, grantTrial, requirePlatformAdmin } from "@/modules/admin";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const GrantTrialSchema = z.object({ days: z.number().int().min(1).max(90) });

// Libera teste gratuito para o tenant por N dias (somente dono da plataforma).
export async function POST(req: Request, routeCtx: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const { tenantId } = await routeCtx.params;
    const { days } = await parseJsonBody(req, GrantTrialSchema);
    return ok(await grantTrial(tenantId, days));
  });
}

// Encerra o teste antes da data de término.
export async function DELETE(_req: Request, routeCtx: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const { tenantId } = await routeCtx.params;
    return ok(await endTrial(tenantId));
  });
}
