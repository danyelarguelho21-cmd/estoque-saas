/**
 * Integração client-side com o PagBank.js (tokenização de cartão) — ver ADR-004.
 *
 * GAP CONHECIDO (documentado em vez de simulado silenciosamente): a tokenização real de
 * cartão exige carregar o script oficial do PagBank.js (URL/versão dependem de credenciais de
 * produção do gateway, que este agente não possui) e chamar a API de criptografia de cartão
 * dele no client-side antes de enviar `cardToken` para `POST /api/billing/subscription`
 * (nunca o PAN em texto puro — PCI). Enquanto o script não está integrado, esta função:
 * - detecta se `window.PagSeguro`/`window.PagBank` já foi carregado (por um script tag futuro
 *   no `<head>`, a ser adicionado quando as credenciais de produção existirem) e usa a API real
 *   se disponível;
 * - caso contrário, lança `PagBankNotLoadedError` — o formulário exibe uma mensagem clara em
 *   vez de fingir sucesso, para nunca mascarar a ausência de integração real em produção.
 */

export class PagBankNotLoadedError extends Error {
  constructor() {
    super("PagBank.js não está carregado — tokenização de cartão indisponível.");
    this.name = "PagBankNotLoadedError";
  }
}

export class VindiPublicKeyMissingError extends Error {
  constructor() {
    super("Chave pública Vindi ausente — configure NEXT_PUBLIC_VINDI_PUBLIC_API_KEY.");
    this.name = "VindiPublicKeyMissingError";
  }
}

interface PagBankCardInput {
  number: string;
  holderName: string;
  expMonth: string;
  expYear: string;
  cvv: string;
}

declare global {
  interface Window {
    PagSeguro?: {
      encryptCard: (input: {
        publicKey: string;
        holder: string;
        number: string;
        expMonth: string;
        expYear: string;
        securityCode: string;
      }) => { hasErrors: boolean; encryptedCard?: string; errors?: unknown[] };
    };
  }
}

export async function tokenizeCard(input: PagBankCardInput): Promise<string> {
  if (process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === "vindi") {
    const publicKey = process.env.NEXT_PUBLIC_VINDI_PUBLIC_API_KEY;
    if (!publicKey) throw new VindiPublicKeyMissingError();
    const vindiApiBase = process.env.NEXT_PUBLIC_VINDI_API_BASE_URL ?? "https://sandbox-app.vindi.com.br/api/v1";
    const response = await fetch(`${vindiApiBase.replace(/\/$/, "")}/public/payment_profiles`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${publicKey}:`)}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        holder_name: input.holderName,
        card_expiration: `${input.expMonth}/${input.expYear}`,
        card_number: input.number.replace(/\s/g, ""),
        card_cvv: input.cvv,
        payment_method_code: "credit_card",
        payment_company_code: detectCardCompany(input.number),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.json().catch(() => ({})) as { gateway_token?: string; payment_profile?: { gateway_token?: string } };
    const gatewayToken = body.payment_profile?.gateway_token ?? body.gateway_token;
    if (!response.ok || !gatewayToken) {
      throw new Error("A Vindi não conseguiu tokenizar este cartão. Confira os dados ou tente outro cartão.");
    }
    return gatewayToken;
  }

  if (typeof window === "undefined" || !window.PagSeguro) {
    throw new PagBankNotLoadedError();
  }

  const result = window.PagSeguro.encryptCard({
    publicKey: process.env.NEXT_PUBLIC_PAGBANK_PUBLIC_KEY ?? "",
    holder: input.holderName,
    number: input.number.replace(/\s/g, ""),
    expMonth: input.expMonth,
    expYear: input.expYear,
    securityCode: input.cvv,
  });

  if (result.hasErrors || !result.encryptedCard) {
    throw new Error("Não foi possível validar os dados do cartão.");
  }

  return result.encryptedCard;
}

function detectCardCompany(value: string): string {
  const number = value.replace(/\D/g, "");
  if (/^4/.test(number)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(number)) return "mastercard";
  if (/^(34|37)/.test(number)) return "amex";
  if (/^(606282|3841)/.test(number)) return "hipercard";
  if (/^(4011|4312|4389|4514|4576|5041|5066|5090|6277|6362|6363)/.test(number)) return "elo";
  throw new Error("Não reconhecemos a bandeira deste cartão. Tente Visa, Mastercard, Elo, Amex ou Hipercard.");
}
