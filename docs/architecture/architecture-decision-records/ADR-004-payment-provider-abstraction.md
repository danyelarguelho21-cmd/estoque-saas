# ADR-004: Abstração de gateway de pagamento (PaymentProvider)

**Status:** Accepted
**Context:** O BRD exige cobrança recorrente via PagBank/PagSeguro, mas a pesquisa de mercado (set/2026) mostrou que o Checkout Recorrente nativo do PagBank hoje suporta **apenas cartão de crédito** — Pix e boleto recorrentes estão listados como "em breve", sem data confirmada. A decisão de negócio (CEO, ver BRD Epic 9) foi: cartão via recorrência nativa do PagBank; Pix/boleto via cobrança avulsa mensal gerada pelo próprio sistema. Além disso, o usuário proibiu explicitamente Mercado Pago e Asaas como gateways.
**Decision:** Toda interação com gateway de pagamento passa por uma interface própria `PaymentProvider` (`libs/shared/payments/provider.ts`), nunca chamada direto ao SDK do PagBank a partir do domínio de billing:
```ts
interface PaymentProvider {
  createRecurringCardCharge(input: RecurringChargeInput): Promise<RecurringChargeResult>;
  createOneOffCharge(input: OneOffChargeInput): Promise<OneOffChargeResult>; // Pix/boleto avulso
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  verifyWebhookSignature(payload: string, signature: string): boolean;
  parseWebhookEvent(payload: unknown): PaymentWebhookEvent; // normaliza para um formato interno
}
```
O módulo `billing` do domínio opera exclusivamente contra essa interface e contra um formato de evento **normalizado** (`PaymentWebhookEvent`), nunca contra o payload bruto do PagBank. A implementação concreta (`PagBankProvider`) vive em `libs/shared/payments/providers/pagbank.ts` e traduz chamadas normalizadas para a API real do PagBank.
**Consequences:**
- Se o PagBank lançar recorrência nativa Pix/boleto, a migração é uma troca dentro de `PagBankProvider`, sem tocar em regras de negócio de assinatura/inadimplência.
- Se for necessário trocar de gateway no futuro (ex: por taxas, por instabilidade), basta implementar um novo `PaymentProvider` e trocar a injeção de dependência — o domínio de billing não muda.
- Testes do módulo `billing` usam um `FakePaymentProvider` (in-memory), tornando a lógica de negócio (ciclos, inadimplência, carência) testável sem depender da API externa.
- Overhead pequeno de indireção, aceitável dado o risco de mudança já identificado (gateway com limitação conhecida).
**Alternatives Considered:**
- **Chamar o SDK do PagBank diretamente do módulo billing:** mais rápido de implementar agora, mas acopla toda a lógica de assinatura ao formato específico da API do PagBank — caro de mudar depois, especialmente dado que já sabemos que uma migração de fluxo (Pix/boleto) é provável. Rejeitado.
