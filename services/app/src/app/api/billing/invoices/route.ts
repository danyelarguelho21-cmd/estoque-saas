import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { listInvoices } from "@/modules/billing";
import { handleRoute, ok, parseQuery } from "@/lib/http";

const QuerySchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

export async function GET(req: Request): Promise<Response> {
  return handleRoute(async () => {
    // allowPendingPayment: ver comentário em rbac.ts — precisa ver a fatura (QR code/boleto) pra
    // conseguir pagar.
    const ctx = await requireRole("billing:manage", { allowPendingPayment: true });
    const filters = parseQuery(new URL(req.url).searchParams, QuerySchema);
    return ok(await listInvoices(ctx.tenantId, filters));
  });
}
