# Notas de deploy — estoque-saas

**Status:** Anotações da passada de revisão/hardening do DevOps (Wave A). Uma passada futura
(Wave B) fará a IaC/CI-CD completa (deploy automatizado para o VPS, monitoramento, etc.). Este
documento cobre apenas o que já existe (`services/app/Dockerfile`, `docker-compose.yml`, `Makefile`)
e o que falta para produção.

## Como `make up` / `make migrate` funcionam hoje

Ver `Makefile` (raiz) e `README.md` para o fluxo completo. Resumo:

1. `npm install` — instala dependências dos workspaces (`libs/shared`, `services/app`); respeita
   `legacy-peer-deps=true` do `.npmrc` (necessário por causa do `next-auth@5` beta, ver ADR-003).
2. `make up` → `docker compose up -d --build` — builda a imagem (`services/app/Dockerfile`, imagem
   única compartilhada por `app` e `worker`, ver ADR-001 e c4-container.md) e sobe os 4 serviços:
   `postgres`, `redis`, `app`, `worker`. `app`/`worker` só iniciam depois que os healthchecks de
   `postgres`/`redis` ficam `healthy` (`depends_on: condition: service_healthy`).
3. `make generate` → `npm run prisma:generate --workspace libs/shared` — gera o Prisma Client
   (necessário antes de rodar o app fora do Docker; dentro da imagem isso já acontece no build
   stage do Dockerfile).
4. `make migrate` → `npm run prisma:migrate --workspace libs/shared` — aplica o schema no Postgres
   via Prisma Migrate. `schemas/migrations/0001_init.sql` é a referência de leitura para as
   políticas RLS (ADR-002); Prisma Migrate é quem efetivamente aplica o schema no banco — evita
   ter duas fontes de verdade concorrentes (nota já presente no `docker-compose.yml`).

`make dev` / `make worker` rodam o app/worker fora do Docker (Node local), assumindo Postgres/Redis
já disponíveis (localhost ou os containers do Compose, já que as portas de `postgres`/`redis`
seguem publicadas para `127.0.0.1` — ver seção de hardening abaixo).

## Revisão do Dockerfile e docker-compose.yml (Wave A)

O scaffold do Solution Architect já estava correto nos pontos estruturais: build multi-stage,
usuário non-root (`USER app`), imagem única para `app`/`worker` sem `output: standalone` (decisão
deliberada — o worker precisa da árvore completa de `node_modules`, não do bundle standalone do
Next.js, ver comentário no próprio Dockerfile), e healthchecks para `postgres`/`redis`/`app`.

Mudanças aplicadas nesta passada:

- **Healthcheck do `worker`** (faltava): o worker não expõe porta HTTP (só consome filas BullMQ),
  então não há endpoint para `curl`/`wget`. Adicionado `pgrep -f 'src/worker/index.ts'` como
  liveness check — confirma que o processo ainda está de pé, não que os jobs estão sendo
  processados com sucesso (isso é responsabilidade de métricas/alerting, fora de escopo aqui).
  `pgrep` faz parte do busybox do `node:24-alpine` (mesma base do Dockerfile), sem precisar de
  pacote adicional.
- **Portas de `postgres`/`redis` vinculadas a `127.0.0.1`** (antes: `0.0.0.0` implícito via
  `"5432:5432"` / `"6379:6379"`): eram publicadas em todas as interfaces do host. Em um VPS isso
  expõe o banco/fila diretamente à internet caso o firewall do host não esteja configurado
  corretamente — defesa em profundidade. `app`/`worker` continuam acessando via rede interna do
  Compose (`postgres:5432`, `redis:6379`, não afetado); ferramentas locais (`psql`, GUI client)
  continuam funcionando via `localhost` normalmente, só o acesso pela rede externa é que deixa de
  existir.
- **`.dockerignore` criado** (não existia) — exclui `node_modules`, `.next`, `.git`, `.env*`,
  `docs/`, `Claude-Production-Grade-Suite/.orchestrator/receipts` etc. do contexto de build,
  reduzindo tempo de build e evitando vazamento acidental de segredos locais (`.env`) para dentro
  da imagem.

Nada mais foi reescrito — o Dockerfile e o docker-compose.yml já builda/valida localmente
(`npm run build --workspace services/app` passa) e a estrutura multi-stage/non-root/healthcheck
já estava correta antes desta revisão.

### Gap identificado (não corrigido aqui — fora do escopo de DevOps)

O healthcheck do serviço `app` (`docker-compose.yml`) e o `oracle-full.sh` dependem das rotas
`/api/healthz` e `/api/readyz`, também citadas no `README.md`. Essas rotas **ainda não existem**
em `services/app/src` — não há nenhum arquivo de rota implementando-as no momento desta revisão.
Isso é esperado no estágio atual (scaffold do Solution Architect, implementação de regras de
negócio/rotas é responsabilidade da fase BUILD/software-engineer, ver "Status" no `README.md`),
mas fica registrado aqui porque **o `docker-compose.yml` não vai reportar o serviço `app` como
`healthy` até essas rotas existirem** — isso bloqueia `depends_on: condition: service_healthy`
para qualquer serviço futuro que dependa de `app` estar saudável. Ação necessária na fase BUILD:
implementar `GET /api/healthz` (liveness simples) e `GET /api/readyz` (checa conexão com o banco).

## O que falta para um deploy real em VPS (fora do escopo desta passada)

O `docker-compose.yml` atual é adequado para desenvolvimento local e para rodar em um VPS **atrás
de uma rede confiável**, mas não inclui terminação TLS nem reverse proxy — isso é
deliberadamente fora do escopo do Dockerfile/compose desta passada (confirmado no c4-container.md:
"tratado no SHIP"). Itens a resolver em uma passada SHIP futura:

1. **Reverse proxy + TLS** na frente do container `app` — Caddy (TLS automático via Let's Encrypt,
   configuração mínima) ou nginx (mais controle manual, requer certbot/renovação separada) são as
   duas opções razoáveis para um VPS genérico. Caddy é o candidato mais simples para o perfil de
   time atual (solo/dupla) — decisão a confirmar no SHIP, não implementada aqui.
2. **Backup do volume `postgres_data`** — não há estratégia de backup automatizado configurada
   ainda (snapshot do volume Docker, `pg_dump` agendado, ou backup gerenciado se migrar para um
   Postgres gerenciado no futuro).
3. **Rotação/gestão de segredos em produção** — hoje `.env` é local ao host (`env_file: .env` no
   compose); para produção, avaliar um cofre de segredos (mesmo que simples, como
   `docker secrets` ou um arquivo `.env` com permissões restritas fora do controle de versão) e
   rotação de `AUTH_SECRET`/`POSTGRES_PASSWORD`/credenciais do PagBank.
4. **Deploy automatizado (CD)** — o CI (`\.github/workflows/ci.yml`) desta passada só valida
   build/testes/imagem Docker; não há job de deploy. Uma passada Wave B deve adicionar um workflow
   de CD (`cd-production.yml`) com estratégia de deploy (rolling restart simples é razoável para
   um único VPS; blue-green/canário são over-engineering para a escala atual, ver ADR-001) e um
   passo de smoke test pós-deploy.
5. **Monitoramento/observabilidade** — fora do escopo desta revisão de containers; fica para uma
   passada de SRE/DevOps dedicada (dashboards, alerting, runbooks).
6. **Log shipping** — hoje os containers logam para stdout (`docker compose logs`), adequado para
   dev; em produção, considerar encaminhar para um agregador (mesmo que simples, ex.: Vector/
   Fluent Bit para um destino gerenciado), já que não há acesso SSH constante ao VPS assumido.

## CI (histórico — `ci.yml` removido, ver `.github/workflows/test.yml`)

> Nota adicionada depois: o `ci.yml` descrito abaixo foi um skeleton inicial (Wave A) e já
> foi removido do repositório. `test.yml` (quality + unit + integration + e2e + performance)
> e `cd-production.yml` (que dispara após `test.yml` passar em `main`) já existem e cobrem
> tudo isto e mais. Seção mantida como registro histórico da decisão original.

Skeleton criado nesta passada: `npm ci` → `prisma generate` → `typecheck` → `lint` → `test
--workspaces --if-present` → `build --workspace services/app` → `docker build -f
services/app/Dockerfile .` (validação de build de imagem, sem push/deploy). Não sobe
Postgres/Redis como serviços do CI (os testes atuais são unit-level; testes de integração contra
banco/fila real ficam para quando existirem testes que realmente precisem disso — adicionar
`services: postgres:`/`redis:` no job nesse momento). Não há job de CD nesta passada.

## Verificação

Docker não está instalado neste ambiente de execução (confirmado nesta sessão) — as mudanças em
`docker-compose.yml`, `.dockerignore` e `.github/workflows/ci.yml` **não foram validadas
executando `docker build`/`docker compose up`/o workflow real do GitHub Actions**. Ver receipt
(`Claude-Production-Grade-Suite/.orchestrator/receipts/T4a-devops.json`) — marcadas como
`UNVERIFIED`. `npm run typecheck --workspaces --if-present` e `npm run lint --workspaces
--if-present` (oracle rápido) foram executados após as edições, já que nenhuma mudança desta
passada altera código-fonte da aplicação (só Dockerfile-adjacentes/CI/docs).

## Atualização — passada SHIP (T7, DevOps)

Os 6 itens listados acima em "O que falta para um deploy real em VPS" foram resolvidos nesta
passada (`/api/healthz` e `/api/readyz` também já existem agora, implementados na fase BUILD —
o gap registrado na seção anterior está fechado). Implementação completa e detalhes de verificação
em **[`production-deployment.md`](./production-deployment.md)**; resumo:

1. **Reverse proxy + TLS** — `docker-compose.prod.yml` (overlay) + `deploy/Caddyfile`. Caddy
   confirmado como escolha (TLS automático via Let's Encrypt, config mínima).
2. **Backup do Postgres** — `scripts/backup-postgres.sh`/`restore-postgres.sh`, pensado para cron
   do host (não mais um container sempre-ativo no Compose).
3. **Segredos em produção** — `scripts/rotate-secrets.sh` (gera valores + documenta ordem de
   rotação sem downtime); decisão de manter `.env` local ao host (chmod 600) confirmada, sem cofre
   dedicado.
4. **CD** — `.github/workflows/cd-production.yml` (build+push no GHCR para auditoria/rollback,
   deploy via SSH com `scripts/deploy.sh`, smoke test pós-deploy em `/api/healthz`/`/api/readyz`).
   Rolling restart simples, confirmado suficiente para a escala atual — sem blue-green/canário.
5. **Monitoramento** — apenas hook de infraestrutura registrado (onde um futuro `/api/metrics`
   viveria); SLOs/alerting/runbooks continuam fora do escopo de DevOps (autoridade de SRE, T9).
6. **Log shipping** — `deploy/vector.toml.example`, não habilitado por padrão (sem destino de
   agregação escolhido pelo time ainda).

Também foi necessário adicionar `prisma:migrate:deploy` (`prisma migrate deploy`, não-interativo)
em `package.json`/`libs/shared/package.json` — `prisma:migrate` (`migrate dev`) existente é
correto para desenvolvimento local (`make migrate`), mas não é seguro para produção/CI (pode
promptear por nome de migração em caso de drift). O CD usa o novo script; `make migrate` local
continua inalterado.

Docker e `docker compose` **estavam disponíveis** neste ambiente de execução (diferente da passada
anterior) — `docker compose config` foi executado de fato contra o overlay novo. Ver
`production-deployment.md`, seção "Verificação desta passada", para o que foi validado por
execução real vs. o que ainda depende de um VPS real (emissão de certificado TLS real, deploy SSH
de ponta a ponta).
