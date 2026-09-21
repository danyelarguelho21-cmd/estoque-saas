# ADR-007: Auditoria imutável

**Status:** Accepted
**Context:** BRD Epic 8 exige que toda movimentação de estoque gere um registro de auditoria imutável (quem, o quê, quando, valores antes/depois).
**Decision:**
1. Tabela `audit_log` (append-only): `id`, `tenant_id`, `user_id`, `entity_type` (ex: `stock_movement`, `product`, `sale`, `subscription`), `entity_id`, `action` (`create`/`update`/`delete`), `before` (jsonb, nullable), `after` (jsonb, nullable), `created_at`.
2. Gravação acontece na mesma transação de banco que a mutação original (garantia de atomicidade — se a auditoria falhar, a mutação também falha e faz rollback), via uma camada de repositório compartilhada (`withAudit()` wrapper em `libs/shared/audit`), não espalhada manualmente por cada handler.
3. Reforço em nível de banco: o usuário de aplicação (`app_user`) tem `GRANT INSERT, SELECT` em `audit_log`, mas **não** `UPDATE`/`DELETE` — imutabilidade garantida pelo Postgres, não apenas por convenção de código.
4. `stock_movements` já é, por natureza, um log append-only de negócio (nunca é editado, apenas compensado por novas movimentações) — `audit_log` complementa cobrindo também mutações fora de estoque (ex: mudança de papel de usuário, edição de produto, alteração de plano).
**Consequences:** Toda a auditoria fica consultável por tenant (via RLS, ADR-002) sem exposição cruzada. Overhead de escrita duplicada (mutação + linha de auditoria) é aceitável dado o volume esperado (<1K tenants, operação de PME, não alta frequência tipo fintech).
**Alternatives Considered:**
- **Log de auditoria via triggers de banco (nível SQL) em vez de camada de aplicação:** mais robusto contra bypass de aplicação, mas triggers em Postgres tornam mais difícil capturar "quem" (o `user_id` da sessão HTTP) sem replicar o mesmo mecanismo de `current_setting` já usado para RLS. Documentado como possível endurecimento futuro (HARDEN), mas a camada de aplicação com `GRANT` restritivo já atende o requisito do MVP.
