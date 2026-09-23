# Planos, Assinatura e Cobrança

Spec: [`api/openapi/billing.yaml`](../../api/openapi/billing.yaml) · Implementação: [`services/app/src/modules/billing`](../../services/app/src/modules/billing)

Ver também [ADR-004](../architecture/architecture-decision-records/ADR-004-payment-provider-abstraction.md)
e [`sequence-billing.md`](../architecture/system-diagrams/sequence-billing.md).

## Planos (público, sem sessão)

`GET /api/plans` — lista os planos disponíveis (Básico/Pro/Enterprise), sem autenticação. Usado na
tela de signup/upgrade.

## Assinatura (requer `sessionCookie`, `billing:manage` = admin)

| Rota | Descrição |
|---|---|
| `GET /api/billing/subscription` | Assinatura atual do tenant |
| `POST /api/billing/subscription` | Assina um plano — `{ planId, paymentMethod: "card"\|"pix_boleto", cardToken? }`. `cardToken` obrigatório se `paymentMethod=card` (token gerado client-side pelo PagBank.js — o backend nunca vê o número do cartão). `402` se pagamento recusado. |
| `PATCH /api/billing/subscription/plan` | Upgrade/downgrade — `409` se o tenant excede os limites do plano alvo (ex: mais produtos do que o novo limite permite). Ver `fitsWithinPlan()` em [`libs/shared/src/plan-limits`](../../libs/shared/src/plan-limits/index.ts). |
| `GET /api/billing/invoices` | Histórico de faturas, paginado |

**Importante — dois caminhos de cobrança distintos** (decisão de negócio registrada em ADR-004,
não uma limitação técnica): o Checkout Recorrente nativo do PagBank hoje só suporta cartão de
crédito. Pix e boleto são cobrança **avulsa mensal** gerada pelo próprio sistema (job
`generateMonthlyCharges`, ver [dev guide](../guides/developer-guide.md)), não uma assinatura
recorrente nativa do gateway.

## Webhook do PagBank

`POST /api/webhooks/pagbank` — sem `sessionCookie` (`security: []`); autenticidade é validada via
`PaymentProvider.verifyWebhookSignature()`, não por sessão. `401` se a assinatura for inválida (evento
rejeitado, não processado).

- **Idempotente por `gateway_event_id`**: reprocessar o mesmo evento (reentrega do gateway) não
  duplica cobrança/assinatura. Implementado como `UPDATE` atômico (`updateMany` + contagem), não
  check-then-act — corrigido de uma race condition encontrada na revisão de código (achado HI-4).
- **Ack rápido, reconciliação assíncrona**: o handler valida assinatura, persiste o evento bruto e
  enfileira a reconciliação real (atualização de `subscriptions`/`invoices`) — não faz a
  atualização de estado inline. Ver SLO `pagbank-webhook-ack-latency` (p95 2s) em
  `Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml`.
- Payload é normalizado internamente para `PaymentWebhookEvent` (`charge.paid` /
  `charge.failed` / `subscription.canceled`) — ver
  [`libs/shared/src/payments/provider.ts`](../../libs/shared/src/payments/provider.ts).
- Se processamento parar, comece pelo runbook
  [pagbank-webhook-processing-stopped.md](../runbooks/pagbank-webhook-processing-stopped.md).

## Próximos passos

- [admin.md](./admin.md) — MRR/churn/inadimplência agregados no painel interno.
- [Guia operacional](../operations/README.md#segredos-em-produção) — rotação de segredos do PagBank.
