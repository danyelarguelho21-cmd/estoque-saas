import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createSubscription, getSubscription } from "@/modules/billing";
import { created, handleRoute, ok, parseJsonBody } from "@/lib/http";

const CreateSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  paymentMethod: z.enum(["card", "pix_boleto"]),
  cardToken: z.string().optional(),
});

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("billing:manage");
    return ok(await getSubscription(ctx.tenantId));
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("billing:manage");
    const input = await parseJsonBody(req, CreateSubscriptionSchema);
    return created(await createSubscription(ctx.tenantId, input));
  });
}
