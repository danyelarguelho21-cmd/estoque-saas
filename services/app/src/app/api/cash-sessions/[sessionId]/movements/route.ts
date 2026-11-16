import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { addCashMovement } from "@/modules/sales";
import { created, handleRoute, parseJsonBody } from "@/lib/http";

const MovementSchema = z.object({
  type: z.enum(["sangria", "suprimento"]),
  amountCents: z.number().int().min(1).max(100_000_000),
  reason: z.string().trim().min(1, "Informe o motivo.").max(200),
});

// Sangria (retirada) ou suprimento (entrada) de dinheiro no caixa aberto.
export async function POST(req: Request, routeCtx: { params: Promise<{ sessionId: string }> }): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("sales:write");
    const { sessionId } = await routeCtx.params;
    const input = await parseJsonBody(req, MovementSchema);
    return created(await addCashMovement(ctx.tenantId, ctx.userId, sessionId, input));
  });
}
