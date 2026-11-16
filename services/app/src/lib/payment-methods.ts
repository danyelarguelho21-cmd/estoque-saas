// Formas de pagamento da venda — lista fixa compartilhada entre servidor (validação Zod, cálculo
// do fechamento de caixa) e cliente (select da Nova venda, telas de caixa). Puro TS, sem
// dependência de servidor, para poder ser importado dos dois lados.
// Os valores batem com o CHECK sales_payment_method_check (migration 20261109130000_cash_register).

export const PAYMENT_METHODS = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "outro"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  dinheiro: "Dinheiro",
  pix: "Pix",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  outro: "Outro",
};

export const PAYMENT_METHOD_NOT_INFORMED = "Não informado";

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** Rótulo para exibir: forma estruturada > texto livre antigo > "Não informado". */
export function paymentMethodDisplay(paymentMethod: string | null | undefined, legacyLabel?: string | null): string {
  if (isPaymentMethod(paymentMethod)) return PAYMENT_METHOD_LABELS[paymentMethod];
  const legacy = legacyLabel?.trim();
  return legacy ? legacy : PAYMENT_METHOD_NOT_INFORMED;
}
