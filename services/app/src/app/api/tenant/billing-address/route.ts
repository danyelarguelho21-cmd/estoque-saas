import { requireRole, updateTenantBillingAddress } from "@/modules/auth";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";
import { BillingAddressSchema } from "@/lib/billing-address";

// Endereço de cobrança do tenant (exigido pelo gateway Pix da Vindi). Só admin do tenant
// ("tenant:manage" — o papel admin é o dono da conta; operador/vendedor recebem 403).
// allowPendingPayment: tenants antigos sem endereço precisam preenchê-lo em /assinatura justamente
// para conseguir gerar o primeiro Pix — bloquear aqui travaria o próprio desbloqueio (ver rbac.ts).
export async function PUT(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("tenant:manage", { allowPendingPayment: true });
    const input = await parseJsonBody(req, BillingAddressSchema);
    return ok(await updateTenantBillingAddress(ctx.tenantId, ctx.userId, input));
  });
}
