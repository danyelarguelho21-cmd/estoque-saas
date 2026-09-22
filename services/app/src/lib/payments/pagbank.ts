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
