# Contribuindo — estoque-saas

Como adicionar uma feature ou corrigir um bug neste repositório respeitando as regras
estabelecidas nas fases DEFINE/BUILD/HARDEN do projeto. Leia primeiro o
[Guia do desenvolvedor](./developer-guide.md) para o ambiente local — este documento foca nas
regras de contribuição em si.

## Antes de escrever código

1. **Entenda em qual módulo sua mudança vive** — `auth`, `catalog`, `stock`, `sales`, `billing`
   ou `admin` (`services/app/src/modules/*`). Se a mudança cruza dois domínios (ex: uma venda
   afeta estoque), o código ainda mora no módulo dono do dado que está sendo escrito
   (`sales` escreve a venda e chama a API pública de `stock`, nunca o inverso escrevendo direto
   nas tabelas de `sales` a partir de `stock`).
2. **Se a mudança toca o schema de banco**, leia [ADR-002](../architecture/architecture-decision-records/ADR-002-multi-tenancy-strategy.md)
   e a seção [RLS e multi-tenancy](./developer-guide.md#rls-e-multi-tenancy--como-escrever-uma-query-nova)
   do guia do desenvolvedor antes de escrever a migration.
3. **Se a mudança adiciona um endpoint**, atualize o spec OpenAPI correspondente em
   `api/openapi/*.yaml` **no mesmo PR** — o spec é o contrato, não uma cópia gerada a partir do
   código.

## A regra de fronteira de módulo (ADR-001)

Um módulo em `services/app/src/modules/*` só pode ser importado através do próprio `index.ts`.
Nunca importe um arquivo interno de outro módulo (`import { foo } from "@/modules/stock/balance"`
de dentro de `modules/sales` é uma violação — importe de `@/modules/stock` mesmo, que reexporta o
que é público).

Isso existe para manter o monolito **extraível**: se um módulo (candidatos priorizados: `billing`
e o parser de NF-e de `stock`, ver plano de extração no fim da ADR-001) precisar virar um serviço
próprio no futuro, a fronteira de import já delimita exatamente sua API pública.

> **Nota:** esta fronteira é hoje enforced por **convenção + revisão de código**, não por uma regra
> de lint automatizada (`services/app/eslint.config.js` usa apenas `eslint-config-next`, sem
> `no-restricted-imports`/`eslint-plugin-boundaries` configurado para isso). Trate-a com o mesmo
> rigor de um lint que falha o build — um PR que importa de dentro de outro módulo deve ser
> recusado na revisão, mesmo que passe CI. Se você quiser fechar essa lacuna adicionando a regra
> de lint de verdade, é uma contribuição bem-vinda, não um pré-requisito para seguir a regra.

## O padrão RLS/`withTenant()` (ADR-002)

Toda leitura ou escrita em uma tabela tenant-scoped passa por `withTenant(tenantId, callback)` —
nunca por `platformPrisma`/`basePrisma` diretamente fora dos casos já documentados (`plans`,
`platform_admins`, e o módulo `admin` com seu próprio `platformAdminPrisma`). Ver exemplos de
código real e a explicação completa em
[Guia do desenvolvedor § RLS e multi-tenancy](./developer-guide.md#rls-e-multi-tenancy--como-escrever-uma-query-nova).

Checklist para toda tabela tenant-scoped **nova**:
- [ ] Coluna `tenant_id uuid not null references tenants(id)`
- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + política `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`
- [ ] Toda query no código de aplicação passa por `withTenant()`
- [ ] `tests/integration/rls-schema-sweep.test.ts` continua verde (ele varre o schema e falha se
      alguma tabela com `tenant_id` não tiver RLS habilitada — é o oracle automatizado desta regra)

## Disciplina de teste

`tests/` é o **oracle de aceite da QA** (ver `Claude-Production-Grade-Suite/qa-engineer/`) — a
suíte que decide se uma mudança está correta, não uma sugestão.

- **Nunca enfraqueça um teste em `tests/` para fazer seu código passar** — nunca `.skip`, nunca
  afrouxe uma asserção, nunca remova um caso, para contornar uma falha. Se você acha que um teste
  está genuinamente errado (não só inconveniente), pare e discuta antes de alterá-lo; a mudança no
  teste passa por revisão própria respondendo "isso enfraquece o oracle?" — o mesmo padrão já
  seguido durante HARDEN (ver `Claude-Production-Grade-Suite/.orchestrator/tasks.md`, onde uma
  divergência real entre o teste do backend e o oracle da QA foi resolvida **a favor da QA**, não
  do código).
- Testes unitários **co-localizados com seu próprio código** (`libs/shared/src/*/index.test.ts`,
  `tests/unit/`) são seus — escreva-os como parte do ciclo red-green normal (teste falha, você
  implementa, teste passa). Uma vez verde, eles entram no mesmo ratchet: não os enfraqueça depois
  para admitir uma mudança posterior sem que isso passe por revisão como qualquer outra mudança de
  oracle.
- Ao corrigir um bug, escreva primeiro um teste que o reproduz (falha), depois corrija o código
  (o teste passa). Isso é o padrão já seguido em todo o histórico HARDEN deste projeto (ex:
  `tests/integration/stock-concurrency.test.ts` para a race condition CR-1,
  `tests/integration/webhook-idempotency.test.ts` para a idempotência do webhook do PagBank).
- Nunca "satisfaça" um teste hardcodando a saída esperada ou fazendo o código especial-casar
  exatamente o input do teste — isso é tão grave quanto enfraquecer o teste (o mesmo princípio na
  outra direção).

## Antes de abrir um PR

Rode localmente exatamente o que `.github/workflows/test.yml` roda:

```bash
npm run typecheck                                            # todos os workspaces
npm run lint                                                  # todos os workspaces
npx vitest run --config tests/vitest.config.ts tests/unit     # unit
npm run test:qa:integration:up                                # sobe postgres-test/redis-test
npx vitest run --config tests/vitest.config.ts tests/integration
npm run test:qa:integration:down
npm run build --workspace services/app                        # build de produção
```

Playwright (`npm run test:qa:e2e`) e os testes de performance (`tests/performance/`, k6) rodam no
CI (`test.yml`) mas exigem a stack completa de pé — rode localmente se sua mudança toca uma
jornada completa (ex: upload de NF-e → conferência → confirmação) ou um caminho de latência
crítico (checkout, listagem de produtos, curva ABC — ver `tests/performance/baselines/`).

**Checklist do PR:**
- [ ] Typecheck limpo (`npm run typecheck`)
- [ ] Lint limpo (`npm run lint`)
- [ ] `tests/unit` e `tests/integration` verdes — nenhum teste alterado para "passar" sem corrigir a causa real
- [ ] Se adicionou endpoint: `api/openapi/*.yaml` atualizado no mesmo PR
- [ ] Se adicionou tabela tenant-scoped: RLS habilitada + `rls-schema-sweep.test.ts` verde
- [ ] Se a mudança é cross-módulo: import feito através do `index.ts` do módulo de destino, nunca de arquivo interno

## Próximos passos

- [Guia do desenvolvedor](./developer-guide.md) — setup local, estrutura do projeto, comandos de teste.
- [Referência de API](../api/README.md) — contratos por domínio.
- [Visão geral de arquitetura](../architecture/overview.md) — ADRs completas.
