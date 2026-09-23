import { Queue } from "bullmq";
import { z } from "zod";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, redisConnectionOptions, type GenerateMonthlyChargeJobData } from "@estoque-saas/shared";
import { requireRole } from "@/modules/auth";
import { createSubscription, getSubscription } from "@/modules/billing";
import { created, handleRoute, ok, parseJsonBody } from "@/lib/http";

const CreateSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  paymentMethod: z.enum(["card", "pix_boleto"]),
  cardToken: z.string().optional(),
});

const monthlyChargeQueue = new Queue<GenerateMonthlyChargeJobData>(QUEUE_NAMES.generateMonthlyCharge, {
  connection: redisConnectionOptions(),
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
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
    const result = await createSubscription(ctx.tenantId, input);

    // BUG FIX (found via manual e2e testing): cadastro/page.tsx promises "a cobrança do primeiro
    // ciclo será gerada automaticamente após a confirmação" — but the ONLY thing that ever
    // generated a pix/boleto charge was the daily 06:00 generate-monthly-charge cron. A tenant
    // confirming checkout at, say, 14:00 saw an empty "Faturas" screen for up to 16h with no
    // feedback that anything was pending, which is indistinguishable from "broken" from the UI's
    // own promise. Enqueue the same job immediately here instead of only waiting for the next
    // scheduled run — generateChargeForTenant() only charges tenants whose subscription is
    // actually due (see subscriptions.ts's fix in this same pass), so this is safe to enqueue
    // unconditionally: it's a no-op scan for every other tenant, a real first invoice for this one.
    if (input.paymentMethod === "pix_boleto") {
      try {
        const job = await monthlyChargeQueue.add("generate-monthly-charge-immediate", {});
        console.log(`[billing/subscription] enfileirado generate-monthly-charge-immediate (jobId=${job.id}) para tenant ${ctx.tenantId}`);
      } catch (err) {
        console.error(`[billing/subscription] FALHA ao enfileirar generate-monthly-charge-immediate para tenant ${ctx.tenantId}:`, err);
        throw err;
      }
    }

    return created(result);
  });
}
