# DevOps — Wave A: revisão de containers e CI skeleton

Notas de trabalho da passada de análise/hardening (T4a). Ver
`docs/architecture/deployment-notes.md` para a versão voltada ao time (o que existe, o que falta
para produção). Este arquivo é o registro de auditoria/decisões desta passada.

## Escopo confirmado (do brief)

- Alvo de deploy: VPS genérico via Docker Compose — **não** Kubernetes (ADR-003, confirmado em
  discovery). Por isso esta passada não gera `infrastructure/kubernetes/`, Terraform, nem
  monitoramento/observabilidade completos — isso é Wave B / fora do escopo explícito desta task.
- Dockerfile e docker-compose.yml **já existiam e já validavam** (`npm run build --workspace
  services/app` passa localmente) — mandato foi revisar/hardenizar, não reescrever.

## Auditoria: `services/app/Dockerfile`

| Item | Status antes | Ação |
|---|---|---|
| Multi-stage (base/deps/build/runtime) | OK | nenhuma |
| Usuário non-root (`USER app`) | OK | nenhuma |
| Imagem única app+worker sem `output: standalone` | OK (deliberado — worker precisa da árvore completa de node_modules) | nenhuma |
| Ordem de cache de layers (deps antes de código) | OK | nenhuma |
| `prisma generate` roda no build stage, antes de `next build`, e node_modules copiado para runtime *depois* do generate | OK — confirmado que o client Prisma gerado é herdado corretamente pelo runtime stage | nenhuma |
| Sem segredos em layers | OK — nenhum `ARG`/`ENV` com valor sensível | nenhuma |

Nenhuma mudança no Dockerfile em si — estava correto.

## Auditoria: `docker-compose.yml`

| Item | Status antes | Ação |
|---|---|---|
| Healthcheck `postgres` | OK (`pg_isready`) | nenhuma |
| Healthcheck `redis` | OK (`redis-cli ping`) | nenhuma |
| Healthcheck `app` | OK (`wget` em `/api/healthz`) | nenhuma — **mas ver gap abaixo** |
| Healthcheck `worker` | **faltava** | Adicionado `pgrep -f 'src/worker/index.ts'` (liveness; worker não tem porta HTTP) |
| Portas `postgres`/`redis` publicadas em todas interfaces (`0.0.0.0` implícito) | Risco em VPS (exposição à internet se firewall mal configurado) | Vinculadas a `127.0.0.1` — não afeta rede interna do Compose (`app`/`worker` continuam resolvendo `postgres`/`redis` pelo nome do serviço) nem ferramentas locais via `localhost` |
| `depends_on: condition: service_healthy` | OK | nenhuma |
| Restart policy (`unless-stopped`) | OK | nenhuma |

### Gap identificado, não corrigido (fora da alçada de DevOps)

`/api/healthz` e `/api/readyz` são referenciados por `docker-compose.yml`, `README.md` e
`oracle-full.sh`, mas **não existem** em `services/app/src` (confirmado via grep — zero arquivos
de rota). Implementar essas rotas é trabalho de aplicação (software-engineer, fase BUILD), não de
DevOps — registrado como gap em `docs/architecture/deployment-notes.md` para não ficar perdido.
Consequência prática: o healthcheck do serviço `app` vai falhar/nunca ficar `healthy` até essas
rotas existirem.

## `.dockerignore` (novo)

Não existia. Criado em `/.dockerignore` — exclui `node_modules`, `.next`, `.git`, `.env*` (exceto
`.env.example`), `docs/`, `Claude-Production-Grade-Suite/.orchestrator/receipts`,
`Claude-Production-Grade-Suite/.orchestrator/loops`, artefatos de teste/cobertura, `infrastructure/`
(não usado por este Dockerfile) e logs.

## CI skeleton (`.github/workflows/ci.yml`, novo)

Versões de actions verificadas via WebSearch em 2026-09-21 (freshness protocol, Tier 2 —
"CI/CD platform syntax"): `actions/checkout@v7` (v7.0.1) e `actions/setup-node@v7` (v7.0.0) são as
major tags atuais no momento desta revisão (runners GitHub-hosted migraram para Node 24 como
runtime das actions a partir de meados de 2026; Node 20 removido em 23/09/2026).

Pipeline: `checkout` → `setup-node` (cache npm) → `npm ci` → `npm run prisma:generate` (adicionado
por mim — não estava na lista literal do brief, mas é pré-requisito comprovado: o próprio
Dockerfile roda `prisma generate` antes de `next build`, e sem isso `typecheck`/`build` quebram
por falta dos tipos gerados do Prisma Client) → `typecheck` → `lint` → `test --workspaces
--if-present` → `build --workspace services/app` → `docker build -f services/app/Dockerfile .`
(só valida que a imagem builda, sem push/deploy).

Fora de escopo desta passada (skeleton, não pipeline completo): serviços Postgres/Redis no job de
CI (testes atuais são unit-level), scan de segurança (SAST/dependency audit), e qualquer job de CD
— tudo fica para uma passada HARDEN/SHIP futura.

## Verificação

- **UNVERIFIED**: Docker não está instalado neste ambiente — `docker build`, `docker compose
  up/config`, e a execução real do workflow do GitHub Actions não puderam ser testados. As
  mudanças foram revisadas por leitura cuidadosa e comparação com o padrão já validado no restante
  do Dockerfile/compose, não por execução.
- `node_modules` também está ausente neste ambiente (`npm install` nunca rodou aqui) — o oracle
  rápido (`oracle.sh`) reportou `UNAVAILABLE` em vez de rodar typecheck/lint. Isso é esperado e
  não é um sinal de regressão: nenhuma mudança desta passada altera código-fonte da aplicação
  (`services/app/src`, `libs/shared/src`) ou scripts de `package.json` — apenas
  `docker-compose.yml`, `.dockerignore`, `.github/workflows/ci.yml` e documentação.
