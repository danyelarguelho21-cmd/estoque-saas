import { PagBankProvider, type PaymentProvider } from "@estoque-saas/shared";

// Instância única do PaymentProvider (ADR-004) — o domínio de billing depende SOMENTE da
// interface PaymentProvider, nunca do SDK/HTTP do PagBank diretamente. Construída lazily (não no
// import-time) para que ambientes sem as env vars configuradas (ex: testes unitários de outras
// partes do sistema) não derrubem o processo só por importar este módulo.
let cached: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  const provider = new PagBankProvider({
    apiKey: process.env.PAGBANK_API_KEY ?? "",
    baseUrl: process.env.PAGBANK_BASE_URL ?? "https://sandbox.api.pagseguro.com",
    webhookSecret: process.env.PAGBANK_WEBHOOK_SECRET ?? "",
    // Use a URL explícita do webhook quando configurada. AUTH_URL continua como fallback para
    // instalações existentes; URLs locais/inválidas são descartadas pelo provider.
    ...((process.env.PAGBANK_WEBHOOK_NOTIFICATION_URL || process.env.AUTH_URL)
      ? {
          webhookNotificationUrl:
            process.env.PAGBANK_WEBHOOK_NOTIFICATION_URL || `${process.env.AUTH_URL}/api/webhooks/pagbank`,
        }
      : {}),
  });
  cached = provider;
  return provider;
}
