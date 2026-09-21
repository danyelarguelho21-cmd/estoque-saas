# Fluxo de dados — estoque-saas

## Entrada de estoque
```
Upload XML → File Storage → job parse-nfe → nfe_import_items (match por cEAN)
  → revisão do operador → confirmação → stock_movements(entrada_nfe) + batches → audit_log
```
Entrada manual pula o parsing: `UI → stock_movements(entrada_manual) + batches (se perecível) → audit_log`, em uma única transação.

## Saída de estoque
```
Venda:     UI → sugestão FEFO (se perecível) → sales + sale_items → stock_movements(saida_venda) → batches.quantity -= X → audit_log
Perda:     UI → motivo obrigatório → stock_movements(saida_perda) → batches.quantity -= X (se aplicável) → audit_log
Transfer.: UI → transfers + transfer_items → stock_movements(transferencia_saida) na origem + stock_movements(transferencia_entrada) no destino → audit_log
```
Toda saída/entrada roda em uma única transação Postgres — nunca há um estado intermediário onde `stock_movements` existe sem o `batches`/`audit_log` correspondente (ou nenhum dos dois existe).

## Cobrança
```
Cartão:      Subscription (PagBank) → webhook por ciclo → invoices (idempotente por gateway_event_id) → subscriptions.status
Pix/boleto:  Job mensal → PaymentProvider.createOneOffCharge() → invoices(pending) → webhook de pagamento → invoices(paid) → subscriptions renovada
```

## Alertas
```
Job diário → varre products (min_stock) e batches (expiry_date) → notifications (in-app)
```

## Isolamento multi-tenant (aplica-se a todo fluxo acima)
```
Request HTTP autenticada → resolve tenant_id da sessão → abre transação Postgres
  → set_config('app.tenant_id', tenant_id, true) → executa queries (RLS filtra automaticamente)
  → commit/rollback
```
Ver ADR-002 para o mecanismo completo.
