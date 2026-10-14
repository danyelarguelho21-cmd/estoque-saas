import { z } from "zod";
import {
  getManagerPinConfigured,
  getManagerUnlockExpiry,
  lockManagerArea,
  requireSession,
  roleHasFinancialAccess,
  unlockWithManagerPin,
} from "@/modules/auth";
import { handleRoute, ok, parseJsonBody } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";

const UnlockSchema = z.object({ pin: z.string().min(1).max(8) });

// Situação da área do gestor para o usuário logado.
export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireSession();
    if (roleHasFinancialAccess(ctx.role)) {
      return ok({ allowed: true, requiresPin: false, unlockedUntil: null, pinConfigured: true });
    }
    const until = await getManagerUnlockExpiry(ctx);
    return ok({
      allowed: until !== null,
      requiresPin: true,
      unlockedUntil: until?.toISOString() ?? null,
      pinConfigured: await getManagerPinConfigured(ctx.tenantId),
    });
  });
}

// Gestor digita o PIN no aparelho do vendedor. Limite de tentativas por usuário (força bruta em
// PIN numérico curto é trivial sem isso): 5 tentativas a cada 15 minutos.
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireSession();
    await checkRateLimit({ key: `rl:manager-pin:${ctx.tenantId}:${ctx.userId}`, limit: 5, windowMs: 15 * 60_000 });
    const { pin } = await parseJsonBody(req, UnlockSchema);
    const until = await unlockWithManagerPin(ctx, pin);
    return ok({ allowed: true, requiresPin: true, unlockedUntil: until.toISOString(), pinConfigured: true });
  });
}

export async function DELETE(): Promise<Response> {
  return handleRoute(async () => {
    await requireSession();
    await lockManagerArea();
    return ok({ allowed: false });
  });
}
