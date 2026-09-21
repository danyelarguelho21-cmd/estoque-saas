# Sequência — Assinatura e cobrança (cartão via PagBank + Pix/boleto avulso)

```mermaid
sequenceDiagram
    actor Admin as Admin do tenant
    participant Web as App Next.js
    participant PP as PaymentProvider (PagBank)
    participant PB as PagBank API
    participant DB as PostgreSQL
    participant Worker as Worker (job mensal)

    alt Pagamento por cartão
        Admin->>Web: Assina plano, escolhe cartão
        Web->>PP: createRecurringCardCharge()
        PP->>PB: POST recorrência (cartão)
        PB-->>PP: subscription_id, status
        PP-->>Web: RecurringChargeResult
        Web->>DB: INSERT subscriptions (status=active, gateway_subscription_id)
        PB->>Web: Webhook (charge.paid / charge.failed) — ciclos seguintes
        Web->>PP: verifyWebhookSignature() + parseWebhookEvent()
        Web->>DB: UPDATE subscriptions / INSERT invoices (idempotente por gateway_event_id)
    else Pagamento por Pix/boleto (avulso mensal)
        Admin->>Web: Assina plano, escolhe Pix/boleto
        Web->>DB: INSERT subscriptions (status=active, payment_method=pix_boleto)
        Worker->>DB: Job mensal: encontra assinaturas pix_boleto com ciclo vencendo em N dias
        Worker->>PP: createOneOffCharge() (Pix QR ou boleto)
        PP->>PB: POST cobrança avulsa (API de Pedidos)
        PB-->>PP: charge_id, qr_code/boleto_url
        Worker->>DB: INSERT invoices (status=pending, due_date)
        Worker-->>Admin: Notificação in-app (cobrança gerada)
        PB->>Web: Webhook (charge.paid) quando o cliente paga
        Web->>PP: verifyWebhookSignature() + parseWebhookEvent()
        Web->>DB: UPDATE invoices SET status=paid; UPDATE subscriptions (renova período)
    end

    Note over Web,DB: Pagamento recusado/vencido sem pagamento → subscriptions.status=past_due,<br/>política de carência (dias definida em Open Question do BRD) antes de restringir acesso.
```
