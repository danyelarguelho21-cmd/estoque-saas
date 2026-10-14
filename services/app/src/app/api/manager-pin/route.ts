import { z } from "zod";
import { getManagerPinConfigured, requireRole, setManagerPin } from "@/modules/auth";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";

// Senha do gestor — só o admin define/troca/remove (Configurações > Senha do gestor).
const PinSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/, "A senha do gestor deve ter de 4 a 8 números.") });

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("tenant:manage");
    return ok({ configured: await getManagerPinConfigured(ctx.tenantId) });
  });
}

export async function PUT(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("tenant:manage");
    const { pin } = await parseJsonBody(req, PinSchema);
    await setManagerPin(ctx.tenantId, ctx.userId, pin);
    return ok({ configured: true });
  });
}

export async function DELETE(): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("tenant:manage");
    await setManagerPin(ctx.tenantId, ctx.userId, null);
    return ok({ configured: false });
  });
}
