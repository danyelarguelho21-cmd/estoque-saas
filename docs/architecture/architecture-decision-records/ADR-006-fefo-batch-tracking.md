# ADR-006: Controle de lote/validade e lógica FEFO

**Status:** Accepted
**Context:** BRD exige controle de validade opcional por produto (módulo configurável por empresa), com lote + data de vencimento, alertas configuráveis (30/15/7 dias) e sugestão FEFO (First-Expired-First-Out) na saída — como sugestão, não bloqueio (regra de negócio explícita do BRD).
**Decision:**
1. Tabela `batches` (lote): `product_id`, `store_id`, `batch_number`, `expiry_date`, `quantity` (saldo atual do lote), `received_at`. Um produto perecível pode ter N lotes ativos por loja.
2. Ao registrar uma saída (venda, perda, transferência) de um produto perecível **sem** lote especificado, o backend consulta os lotes daquele produto/loja com `quantity > 0` ordenados por `expiry_date ASC` e sugere a combinação de lotes que atende a quantidade solicitada (FEFO). A API retorna a sugestão; o cliente (UI) permite ao operador aceitar ou sobrepor manualmente.
3. Toda saída, seja pela sugestão aceita ou por escolha manual, grava em `stock_movements.metadata` (jsonb) se a sugestão FEFO foi seguida ou sobreposta — atende ao requisito de "o sistema registra quando a sugestão foi ignorada".
4. Alertas de validade: job diário (BullMQ repeatable job) varre `batches` com `expiry_date` dentro da janela configurada (`stock_alerts_config.expiry_alert_days`, default `[30, 15, 7]`) e gera notificações in-app (tabela `notifications`) — sem necessidade de infraestrutura de push/e-mail no MVP (pode ser adicionado depois sem mudar o job).
5. Ativar/desativar o módulo de validade é um campo booleano em `tenants` (`perishable_tracking_enabled`); quando desativado, os campos de lote somem da UI e a lógica FEFO não é acionada, mas o schema permanece o mesmo para todos os tenants (simplicidade de migração — ADR-002).
**Consequences:** A sugestão FEFO é uma função pura e testável (dado saldo de lotes + quantidade requisitada → lista de lotes/quantidades sugeridos), independente de HTTP — facilita testes unitários. O custo de manter lotes mesmo para tenants sem produtos perecíveis é uma tabela vazia, irrelevante em custo de storage.
**Alternatives Considered:**
- **FEFO obrigatório (bloqueante):** rejeitado pelo BRD explicitamente — operador pode ter razões operacionais (ex: lote fisicamente mais acessível) para sobrepor.
- **Alertas por e-mail desde o MVP:** adiado — BRD não pede canal específico, apenas "alerta configurável"; notificação in-app atende e é mais simples de implementar/testar sem depender de provedor de e-mail transacional.
