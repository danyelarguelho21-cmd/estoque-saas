import { grantAccess, requirePlatformAdmin, revokeAccess } from "@/modules/admin";
import { handleRoute, ok } from "@/lib/http";

// Libera acesso completo sem cobrança e sem prazo (cortesia) — somente dono da plataforma.
export async function POST(_req: Request, routeCtx: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const { tenantId } = await routeCtx.params;
    return ok(await grantAccess(tenantId));
  });
}

// Remove o acesso cortesia (volta para pagamento pendente).
export async function DELETE(_req: Request, routeCtx: { params: Promise<{ tenantId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    await requirePlatformAdmin();
    const { tenantId } = await routeCtx.params;
    return ok(await revokeAccess(tenantId));
  });
}
