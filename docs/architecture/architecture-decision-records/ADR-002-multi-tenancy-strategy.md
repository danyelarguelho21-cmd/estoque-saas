# ADR-002: Estratégia de multi-tenancy — Schema compartilhado + Row-Level Security

**Status:** Accepted
**Context:** O BRD exige isolamento de dados "obrigatório e reforçado em nível de banco, não apenas filtro de aplicação" entre empresas clientes (tenants). A escala esperada é < 1.000 tenants no primeiro ano, operados por um time pequeno, sem requisito de compliance que force isolamento físico (o BRD não lista HIPAA/PCI — apenas LGPD).
**Decision:** Usar **um único schema Postgres compartilhado**, com **`tenant_id` (uuid) em toda tabela com dado de tenant**, e **Row-Level Security (RLS) nativa do Postgres** como camada de enforcement, adicional (não substituta) ao filtro de aplicação. Padrão de implementação (verificado como prática corrente em 2026):
1. Toda tabela tenant-scoped tem `tenant_id uuid not null references tenants(id)`.
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + política: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`.
3. A cada requisição HTTP autenticada, a camada de acesso a dados abre uma transação e executa `SELECT set_config('app.tenant_id', $1, true)` (escopo de transação, `is_local = true`) com o `tenant_id` do usuário autenticado, antes de qualquer query — implementado como uma extensão do Prisma Client (`$extends`) que envolve toda operação em `prisma.$transaction`.
4. O usuário de aplicação do Postgres (`app_user`) **não** tem `BYPASSRLS`; apenas um usuário de migração administrativo separado tem esse privilégio.
5. Tabelas verdadeiramente globais (não tenant-scoped): `plans` (catálogo de planos do SaaS) e `platform_admins` (usuários internos do dono do SaaS) — RLS desabilitada nessas.
**Consequences:**
- Isolamento sobrevive a bugs de aplicação (ex: um desenvolvedor esquecer o `WHERE tenant_id = ...` em uma query) — a política RLS bloqueia o acesso mesmo assim. Isso atende diretamente o requisito do BRD.
- Uma única migração de schema atende todos os tenants — operação simples, sem precisar rodar N migrações.
- Custo de infraestrutura baixo (um único banco/schema), compatível com o orçamento e a escala do MVP.
- Exige disciplina: toda nova tabela tenant-scoped precisa lembrar de (a) ter `tenant_id`, (b) habilitar RLS, (c) criar a política. Mitigado com teste automatizado (QA) que varre o schema e falha o build se alguma tabela com `tenant_id` não tiver RLS habilitada.
- `current_setting` mal configurado (ex: contexto de tenant não setado) deve **falhar fechado** — a política usa `current_setting('app.tenant_id', true)` que retorna NULL se não setado, e `tenant_id = NULL` nunca é verdadeiro em SQL, logo nenhuma linha é retornada (fail-safe, não fail-open).
**Alternatives Considered:**
- **Schema por tenant:** isolamento físico mais forte, mas migrações precisam rodar em N schemas (custo operacional cresce linearmente com o número de clientes) e a maioria dos ORMs (incluindo Prisma) tem suporte limitado a schema dinâmico por request. Rejeitado pelo usuário na entrevista de discovery — escala atual não justifica.
- **Banco por tenant:** isolamento máximo, mas inviável operacionalmente para centenas/milhares de tenants com time pequeno. Rejeitado.
- **RLS sem `tenant_id` em toda tabela (apenas em tabelas "raiz"):** rejeitado — tabelas filhas (ex: `stock_movements`) também precisam de `tenant_id` direto (não apenas via join) para que a política RLS seja auto-contida e não dependa de subqueries custosas a cada linha.
