import { Queue } from "bullmq";
import { z } from "zod";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, redisConnectionOptions, type GenerateMonthlyChargeJobData } from "@estoque-saas/shared";
import { requireRole } from "@/modules/auth";
import { createOrGetInitialInvoice, createSubscription, getSubscription } from "@/modules/billing";
import { PaymentUnavailableError } from "@estoque-saas/shared";
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
    // allowPendingPayment: ver comentário em rbac.ts — esta rota É o checkout, tem que continuar
    // acessível antes do primeiro pagamento.
    const ctx = await requireRole("billing:manage", { allowPendingPayment: true });
    return ok(await getSubscription(ctx.tenantId));
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const ctx = await requireRole("billing:manage", { allowPendingPayment: true });
    const input = await parseJsonBody(req, CreateSubscriptionSchema);
    const subscription = await createSubscription(ctx.tenantId, input);

    // Checkout precisa retornar os dados de pagamento antes da navegação. Enfileirar um scan
    // assíncrono deixava a tela de assinatura vazia até o worker processar o job e não fornecia
    // QR/copia-e-cola ao navegador.
    let invoice = null;
    let checkoutFailureMessage: string | undefined;
    if (input.paymentMethod === "pix_boleto") {
      try {
        invoice = await createOrGetInitialInvoice(ctx.tenantId);
      } catch (err) {
        // A interface só deve confirmar o checkout quando houver uma cobrança pagável. Responder
        // 201 com invoice:null fazia o botão parecer concluir sem gerar QR nem explicar a falha.
        const gatewayError = err as { status?: unknown; body?: { error_messages?: unknown } };
        console.error(
          `[billing/subscription] cobrança Pix não gerada para tenant ${ctx.tenantId} (gateway_status=${String(gatewayError.status ?? "unknown")})`,
          gatewayError.body?.error_messages ? JSON.stringify(gatewayError.body.error_messages) : err,
        );
        if (gatewayError.status === 401) {
          checkoutFailureMessage = "O serviço de pagamentos recusou a autenticação. Entre em contato com o suporte.";
        }
      }
      if (!invoice?.pixQrCode) {
        try {
          await monthlyChargeQueue.add("generate-monthly-charge-immediate", {});
        } catch (err) {
          // O cron diário segue como backstop; a tela de assinatura continua oferecendo retry.
          console.error(`[billing/subscription] não foi possível enfileirar retry Pix para tenant ${ctx.tenantId}:`, err);
        }
        throw new PaymentUnavailableError(checkoutFailureMessage);
      }
    }

    return created({ subscription, invoice });
  });
}
