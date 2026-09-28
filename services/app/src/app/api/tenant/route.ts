import { z } from "zod";
import { getTenant, requireRole, requireSession, updateTenant } from "@/modules/auth";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

const UpdateSchema = z.object({
  consolidatedStock: z.boolean().optional(),
  perishableTrackingEnabled: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    // allowPendingPayment: a tela de Assinatura (que mostra nome/dados do tenant) precisa
    // continuar acessível mesmo antes do primeiro pagamento — ver rbac.ts.
    const ctx = await requireSession({ allowPendingPayment: true });
    return ok(await getTenant(ctx.tenantId));
  });
}

export async function PATCH(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("tenant:manage");
    const input = await parseJsonBody(req, UpdateSchema);
    return ok(await updateTenant(ctx.tenantId, ctx.userId, input));
  });
}
