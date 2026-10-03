// Valor da fatura local = o que o gateway cobrou (Vindi: bill.amount), não plan.priceCents — os dois
// divergiam (Zolo exibia R$ 149,90 enquanto a Vindi cobrava R$ 149,00). Sem valor do gateway, cai
// no preço do plano. Divergência é logada para alguém corrigir o preço no lado que estiver errado.
export function resolveInvoiceAmount(charge: { amountCents?: number | undefined }, planPriceCents: number, context: string): number {
  if (charge.amountCents === undefined) return planPriceCents;
  if (charge.amountCents !== planPriceCents) {
    console.warn(`[billing] valor cobrado pelo gateway (${charge.amountCents} centavos) difere do preço do plano no Zolo (${planPriceCents} centavos) — ${context}. Usando o valor do gateway na fatura.`);
  }
  return charge.amountCents;
}
