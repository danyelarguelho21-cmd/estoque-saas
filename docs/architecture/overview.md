# Visão geral de arquitetura — estoque-saas

Ponto de entrada para quem chega novo ao código. Resume as decisões registradas nas ADRs e nos
diagramas C4/sequência — **os documentos originais são a fonte de verdade**; esta página existe
para dar o mapa geral antes de mergulhar neles.

## O sistema em uma frase

Um monolito modular (Next.js + worker de jobs, TypeScript) com um único Postgres compartilhado
entre tenants, isolado por Row-Level Security — desenhado para um time solo/dupla operando em um
único VPS, não para escala de milhares de tenants ou alta disponibilidade multi-região.

## Contexto (quem usa o sistema)

```
Admin/Operador/Vendedor (empresa cliente) --HTTPS--> estoque-saas <--HTTPS/REST--> PagBank/PagSeguro
Admin do SaaS (painel interno) -----------HTTPS------^        ^
                                                                |
                                          Fornecedor --(XML de NF-e, fora do sistema)--> Operador
```

estoque-saas tem **um único sistema externo de integração real**: o PagBank/PagSeguro (gateway de
pagamento, atrás da interface `PaymentProvider` — [ADR-004](./architecture-decision-records/ADR-004-payment-provider-abstraction.md)).
O fornecedor não integra diretamente — o XML de NF-e chega por fora (e-mail, portal do fornecedor)
e é importado manualmente pelo operador ([ADR-005](./architecture-decision-records/ADR-005-nfe-xml-import.md)).
Diagrama completo: [c4-context.md](./system-diagrams/c4-context.md).

## Containers (como o sistema é implantado)

| Container | Tecnologia | Responsabilidade |
|---|---|---|
| `web` | Next.js 16 / Node 24 | UI (React) + API (Route Handlers). Todos os módulos de domínio. |
| `worker` | Node 24 / BullMQ | Parsing de XML de NF-e, geração de cobranças mensais, varredura de alertas (estoque baixo/validade) |
| `postgres` | PostgreSQL 18 | Schema único, RLS por `tenant_id` |
| `redis` | Redis 7 | Fila BullMQ + cache de sessão/consulta |
| storage de arquivos | volume local (`LocalFileStorage`) | XMLs de NF-e e CSVs enviados |

`web` e `worker` compartilham a mesma imagem Docker e base de código — diferem apenas no `CMD` de
entrada (mesmo monolito, ADR-001). Diagrama completo: [c4-container.md](./system-diagrams/c4-container.md).

> **Nota de precisão:** o diagrama C4 descreve o storage de arquivos como "Volume local (dev) /
> S3-compatible (prod)". Isso é a **direção pretendida** da interface `FileStorage`
> ([`libs/shared/src/storage/index.ts`](../../libs/shared/src/storage/index.ts)), desenhada para
> permitir trocar a implementação sem tocar módulos de domínio (ADR-005) — mas **hoje só existe
> `LocalFileStorage`**. Não há implementação S3/MinIO no código. Trate "S3-compatible" como um
> ponto de extensão documentado, não uma capacidade em produção.

## As duas decisões que mais moldam o código

### ADR-001 — Monolito modular

Um único deployable, módulos de domínio isolados por diretório (`auth`, `catalog`, `stock`,
`sales`, `billing`, `admin`), comunicação entre módulos só via `index.ts` de cada um. Rejeitou
microsserviços (complexidade operacional não se paga na escala atual) e "big ball of mud" (as
fronteiras de domínio já são claras o bastante para valer a pena isolar desde já). Se a escala
justificar extração futura, `billing` e o parser de NF-e de `stock` são os candidatos priorizados
— ambos já rodam via fila BullMQ, o que facilita a extração sem mudar a interface de mensagens.

-> [ADR-001 completa](./architecture-decision-records/ADR-001-architecture-pattern.md) ·
[Como isso afeta código novo](../guides/developer-guide.md#estrutura-do-projeto)

### ADR-002 — Multi-tenancy via schema compartilhado + RLS

Um único schema Postgres, `tenant_id` em toda tabela tenant-scoped, política RLS nativa do
Postgres como camada de enforcement **adicional** ao filtro de aplicação — não substituta. A
aplicação conecta com uma role restrita (`app_user`, sem `BYPASSRLS`); cada requisição abre uma
transação e seta `app.tenant_id` via `set_config()` antes de qualquer query. Um bug de aplicação
que esqueça um `WHERE tenant_id = ...` ainda é bloqueado pelo banco — a política falha fechado
(`current_setting` não setado -> nenhuma linha retornada, nunca todas).

-> [ADR-002 completa](./architecture-decision-records/ADR-002-multi-tenancy-strategy.md) ·
[Como escrever uma query nova respeitando isso](../guides/developer-guide.md#rls-e-multi-tenancy--como-escrever-uma-query-nova)

## Todas as ADRs

| ADR | Decisão | Resumo em uma linha |
|---|---|---|
| [001](./architecture-decision-records/ADR-001-architecture-pattern.md) | Monolito modular | Um deployable, módulos isolados por diretório, extraível no futuro |
| [002](./architecture-decision-records/ADR-002-multi-tenancy-strategy.md) | Multi-tenancy: schema compartilhado + RLS | Isolamento reforçado no banco, não só na aplicação |
| [003](./architecture-decision-records/ADR-003-tech-stack.md) | Stack tecnológica | Next.js 16 + Postgres 18 + Prisma + Redis/BullMQ + Auth.js, VPS via Docker Compose |
| [004](./architecture-decision-records/ADR-004-payment-provider-abstraction.md) | Abstração `PaymentProvider` | Domínio de billing nunca chama o SDK do PagBank direto; cartão recorrente nativo, Pix/boleto avulso gerado pelo sistema |
| [005](./architecture-decision-records/ADR-005-nfe-xml-import.md) | Importação de XML de NF-e | Upload -> parsing assíncrono -> conferência manual -> confirmação grava estoque |
| [006](./architecture-decision-records/ADR-006-fefo-batch-tracking.md) | Lote/validade e FEFO | Controle de validade opcional por tenant; FEFO é sugestão, nunca bloqueio |
| [007](./architecture-decision-records/ADR-007-audit-log.md) | Auditoria imutável | Toda movimentação de estoque gera registro append-only (quem, o quê, quando, antes/depois) |

## Princípios de design transversais

Resumidos em [design-principles.md](./design-principles.md) (12-Factor App, defesa em
profundidade — autenticação -> RBAC -> RLS -> auditoria —, idempotência em escritas críticas via
`gateway_event_id`, zero-trust interno entre a sessão de tenant e a sessão do painel
administrativo). Não duplicado aqui.

## Diagramas de sequência

Para os fluxos mais complexos, o "como" passo a passo:

| Diagrama | Fluxo |
|---|---|
| [sequence-fefo-sale.md](./system-diagrams/sequence-fefo-sale.md) | Venda com sugestão FEFO automática |
| [sequence-nfe-import.md](./system-diagrams/sequence-nfe-import.md) | Upload -> parsing assíncrono -> conferência -> confirmação de NF-e |
| [sequence-billing.md](./system-diagrams/sequence-billing.md) | Assinatura, cobrança recorrente/avulsa e reconciliação de webhook |

## Modelo de dados

[ERD completo](../../schemas/erd.md) e [fluxo de dados](../../schemas/data-flow.md) em `schemas/`.
Todas as tabelas exceto `plans` e `platform_admins` têm `tenant_id` direto (mesmo quando
alcançável via join) e RLS habilitada — decisão deliberada da ADR-002 para manter cada política
auto-contida.

## Próximos passos

- [Referência de API](../api/README.md) — contratos por domínio.
- [Guia do desenvolvedor](../guides/developer-guide.md) — como rodar e escrever código aqui.
- [Guia operacional](../operations/README.md) — deploy, SLOs, runbooks.
