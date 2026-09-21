# C4 — Contexto do Sistema

```mermaid
C4Context
  title estoque-saas — Diagrama de Contexto

  Person(admin, "Admin do tenant", "Dono/gerente da empresa cliente")
  Person(operador, "Operador de estoque", "Cadastra produtos, entradas/saídas")
  Person(vendedor, "Vendedor", "Registra vendas")
  Person(saas_admin, "Admin do SaaS", "Dono da plataforma, gerencia assinantes")

  System(estoque_saas, "estoque-saas", "SaaS multi-tenant de gestão de estoque por assinatura")

  System_Ext(pagbank, "PagBank/PagSeguro", "Gateway de pagamento — cartão recorrente + Pix/boleto avulso")
  System_Ext(fornecedor, "Fornecedor", "Emite NF-e; operador importa o XML no sistema")

  Rel(admin, estoque_saas, "Configura empresa, lojas, planos, vê dashboards")
  Rel(operador, estoque_saas, "Cadastra produtos, entradas/saídas, transferências")
  Rel(vendedor, estoque_saas, "Registra vendas, consulta estoque")
  Rel(saas_admin, estoque_saas, "Gerencia assinantes via painel interno")
  Rel(estoque_saas, pagbank, "Cria cobrança recorrente (cartão) / avulsa (Pix, boleto); recebe webhooks", "HTTPS/REST")
  Rel(fornecedor, operador, "Envia XML de NF-e (fora do sistema, ex: e-mail)")
```

## Atores e sistemas externos
- **Admin do tenant / Operador / Vendedor**: usuários finais do produto, dentro de uma empresa cliente (tenant).
- **Admin do SaaS**: usuário interno, dono da plataforma, opera o painel administrativo separado.
- **PagBank/PagSeguro**: único sistema externo de pagamento (ADR-004), acessado via `PaymentProvider`.
- **Fornecedor**: não integra diretamente ao sistema — o XML de NF-e chega por fora (e-mail, download do portal do fornecedor) e é importado manualmente pelo operador (ADR-005).
