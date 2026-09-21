# ADR-001: Padrão de arquitetura — Monolito Modular

**Status:** Accepted
**Context:** O produto (estoque-saas) está no estágio de MVP, construído por um time solo/dupla, com meta de menos de 1.000 empresas-tenant no primeiro ano e sem exigência de tempo real. O BRD define 9 epics (multi-tenant, catálogo, entradas/saídas, vendas, alertas, dashboards, RBAC/auditoria, cobrança) fortemente acoplados pelo mesmo domínio (estoque) e pelo mesmo modelo de dados (tenant → lojas → produtos → movimentações).
**Decision:** Adotar um **monolito modular** em um único deployable (Next.js App Router, TypeScript), com módulos de domínio isolados por diretório (`src/modules/{catalog,stock,sales,billing,admin,auth}`), cada um com suas próprias regras de negócio, acesso a dados via um repositório dedicado, e fronteiras de import reforçadas por lint (nenhum módulo importa direto de dentro de outro — comunicação via interfaces exportadas em `src/modules/*/index.ts`). Um único banco Postgres, um único processo de aplicação, um worker de background jobs separado (mesma base de código, entrypoint diferente) para tarefas assíncronas (import de XML pesado, geração de cobranças, alertas de validade).
**Consequences:**
- Deploy único, operação simples, adequado ao time atual (positivo).
- Migrações e transações cruzando módulos (ex: venda debita estoque e pode gerar alerta) são triviais dentro do mesmo processo/transação — sem necessidade de saga/coreografia distribuída (positivo).
- Se o produto crescer muito (>15 pessoas no time, ou necessidade de escalar um módulo isoladamente, ex: processamento de NF-e em alto volume), a extração de um módulo para serviço próprio exige disciplina nas fronteiras já estabelecidas — o design modular antecipa essa extração futura (ver plano de extração abaixo), mas não a implementa agora (custo evitado).
- Nenhum módulo pode ser escalado horizontalmente de forma independente — aceitável na escala atual.
**Alternatives Considered:**
- **Microsserviços desde o início:** rejeitado — complexidade operacional (service mesh, observabilidade distribuída, deploy multi-serviço) não se paga para um time solo/dupla e escala < 1K tenants. Motivo do BRD/constraints: rodar localmente, produção futura em VPS simples.
- **Monolito não-modular ("big ball of mud"):** rejeitado — o domínio tem fronteiras claras (catálogo, estoque, vendas, cobrança, admin) que, se não isoladas desde o início, tornam qualquer extração futura ou mesmo manutenção corrente muito mais cara.

## Plano de extração futura (não implementado agora, apenas documentado)
Se a escala justificar, os módulos com maior probabilidade de extração isolada são, em ordem: (1) `billing` (cobrança/webhooks do PagBank — carga assíncrona e sensível a picos de webhook), (2) `stock` → especificamente o parser de NF-e (processamento pesado de XML). Ambos já rodam via fila de jobs (BullMQ/Redis) no monolito, o que facilita a extração — o worker vira um processo/deploy independente sem mudar a interface de mensagens.
