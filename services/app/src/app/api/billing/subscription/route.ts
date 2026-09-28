import { z } from "zod";
import { requireRole } from "@/modules/auth";
import { createOrGetInitialInvoice, createSubscription, getSubscription } from "@/modules/billing";
import { created, handleRoute, ok, parseJsonBody } from "@/lib/http";

const CreateSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  paymentMethod: z.enum(["card", "pix_boleto"]),
  cardToken: z.string().optional(),
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
    if (input.paymentMethod === "pix_boleto") {
      invoice = await createOrGetInitialInvoice(ctx.tenantId);
      if (!invoice) throw new Error("Não foi possível gerar a fatura inicial para esta assinatura.");
    }

    return created({ subscription, invoice });
  });
}
