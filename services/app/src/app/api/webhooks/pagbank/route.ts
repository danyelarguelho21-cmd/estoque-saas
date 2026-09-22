import { processPagBankWebhook } from "@/modules/billing";
import { handleRoute, ok } from "@/lib/http";

// api/openapi/billing.yaml#pagbankWebhook — security: [] (sem sessão), autenticidade verificada
// via header x-authenticity-token (ver PagBankProvider.verifyWebhookSignature). Lê o corpo como
// texto BRUTO (nunca req.json() + re-stringify) — a assinatura é byte-sensível.
export async function POST(req: Request): Promise<Response> {
  return handleRoute(async () => {
    const rawBody = await req.text();
    const signature = req.headers.get("x-authenticity-token");
    await processPagBankWebhook(rawBody, signature);
    return ok({ status: "processed" });
  });
}
