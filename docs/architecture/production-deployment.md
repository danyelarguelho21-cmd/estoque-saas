# Deploy em produção — estoque-saas

**Status:** produzido na passada SHIP (T7) de DevOps, que resolve os itens listados como "fora do
escopo" em `deployment-notes.md` (Wave A). Este documento é a referência operacional completa para
colocar o estoque-saas em produção em um VPS único via Docker Compose (ADR-001) — **não** cobre
SLOs, alerting ou runbooks de incidente, que são responsabilidade da passada de SRE (T9, roda
depois desta).

## Visão geral

```
Internet ──HTTPS──▶ Caddy (80/443, TLS automático) ──▶ app:3000 (rede interna Docker)
                                                            │
                                                     postgres / redis / worker
```

Continua sendo Docker Compose em um único VPS genérico — nenhuma dependência de nuvem específica
(AWS/GCP/Azure), Kubernetes ou Terraform foi introduzida (ver ADR-003 e
`system-diagrams/c4-container.md`). Se o time crescer além da escala solo/dupla assumida em
discovery e isso deixar de ser suficiente, isso é uma decisão de arquitetura a ser revisitada
explicitamente (nova ADR), não algo para introduzir silenciosamente numa passada de DevOps.

## 1. Reverse proxy + TLS (Caddy)

Novo overlay `docker-compose.prod.yml`, usado **junto** com o `docker-compose.yml` de base:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

O overlay:
- adiciona o serviço `caddy` (imagem `caddy:2.11-alpine`), expondo `80/tcp`, `443/tcp` e
  `443/udp` (HTTP/3) — as únicas portas públicas do host em produção;
- remove a publicação da porta `3000` do serviço `app` (`ports: !override []`) — em produção
  `app` só é alcançável via `caddy` (rede Docker interna, `app:3000`) ou via SSH
  (`docker compose exec`/`logs`) direto no host.

Configuração do Caddy em `deploy/Caddyfile` — TLS automático via Let's Encrypt, sem certbot nem
renovação manual: basta `DOMAIN`/`TLS_EMAIL` corretos em `.env` (ver `.env.example`). O
`reverse_proxy` também faz health check ativo contra `/api/healthz` do upstream (independente do
healthcheck do Docker Compose), então o Caddy para de rotear tráfego para `app` se a rota de
liveness começar a falhar sem o container ter morrido.

**Por que Caddy e não nginx:** TLS automático com configuração mínima é o que importa para o perfil
de time atual (solo/dupla, sem tempo dedicado a operar certbot/renovação manual) — já era a
recomendação registrada em `deployment-notes.md` desta mesma decisão, aqui só implementada.

## 2. Backup do Postgres

`scripts/backup-postgres.sh` — dump lógico completo (`pg_dump | gzip`) via
`docker compose exec postgres pg_dump`, com rotação por idade (`BACKUP_RETENTION_DAYS`, default 14
dias). Não introduz mais um container sempre-ativo no Compose (decisão: um serviço de backup rodando
o tempo todo só para acordar 1x/dia duplicaria credenciais de banco em outro lugar sem necessidade
real) — em vez disso, é pensado para rodar como **cron do host**:

```cron
0 3 * * * cd /opt/estoque-saas && ./scripts/backup-postgres.sh >> /var/log/estoque-backup.log 2>&1
```

`scripts/restore-postgres.sh <arquivo.sql.gz>` reverte um backup — operação destrutiva, pede
confirmação interativa, para `app`/`worker` antes de aplicar o dump (evita escrita concorrente) e
reinicia depois.

**Importante — offsite:** os backups ficam em `./backups` no próprio VPS por padrão. Isso protege
contra erro humano/corrupção lógica, mas **não** contra falha do disco/VPS inteiro. Configure
`rclone`/`rsync`/`scp` periódico desse diretório para outro host ou object storage — não
automatizado aqui deliberadamente (a escolha do destino é do time/orçamento, fora do que DevOps
pode decidir sozinho).

## 3. Segredos em produção

Decisão mantida (ADR-001, escala solo/dupla): `.env` local ao host, fora do controle de versão,
**não** um cofre dedicado (Vault/AWS Secrets Manager) — seria over-engineering nesta escala.
DevOps garante:

- `chmod 600 .env` no host, dono = usuário de deploy apenas;
- `scripts/rotate-secrets.sh` — gera novos valores (`AUTH_SECRET`,
  `PLATFORM_ADMIN_SESSION_SECRET`, senhas de banco) e imprime o passo a passo de rotação sem
  downtime (ordem: `ALTER ROLE` no Postgres → atualizar `.env` → `docker compose up -d --build`);
  para PagBank, a rotação é manual no painel do provedor (não pode ser gerada localmente) — o
  script documenta os passos.
- Cadência recomendada: 90 dias, ou imediatamente após suspeita de vazamento.

## 4. CD (`​.github/workflows/cd-production.yml`)

Dispara depois que `ci.yml` conclui com sucesso na branch `main` (via `workflow_run`), ou
manualmente (`workflow_dispatch`, informando `ref`). Três jobs:

1. **build-and-push** — builda a imagem e publica no GHCR (`ghcr.io/<repo>-app:<sha>` e `:latest`)
   **somente** como trilha de auditoria/rollback manual (permite `docker pull` de uma imagem
   antiga específica para inspecionar fora do VPS). **Não** é essa imagem publicada que roda em
   produção.
2. **deploy** — SSH no VPS (`appleboy/ssh-action@v1`) e roda `scripts/deploy.sh`, que faz
   `git pull` + `npm ci` + `prisma migrate deploy` (não-interativo — diferente de `make migrate`
   local, que usa `prisma migrate dev`) + grants/seed idempotentes + `docker compose up -d --build`
   (build local no VPS a partir do commit já sincronizado — rolling restart simples, sem
   blue-green/canário, que seriam over-engineering nesta escala per `deployment-notes.md`).
   O job usa o Environment `production` do GitHub — configure em Settings > Environments se quiser
   exigir approval manual antes do deploy.
3. **smoke-test** — chama `/api/healthz` e `/api/readyz` no domínio público (`PRODUCTION_BASE_URL`),
   com retry (10 tentativas, 6s de intervalo); falha o workflow se não responder 200.

**Segredos do GitHub necessários** (Settings > Secrets and variables > Actions, ou no Environment
`production`):

| Secret | Uso |
|---|---|
| `VPS_HOST` | host/IP do VPS |
| `VPS_USER` | usuário SSH de deploy |
| `VPS_SSH_KEY` | chave privada SSH (par dedicado ao deploy, não a chave pessoal do operador) |
| `VPS_DEPLOY_DIR` | caminho absoluto do repositório clonado no VPS (ex.: `/opt/estoque-saas`) |
| `PRODUCTION_BASE_URL` | URL pública (ex.: `https://app.seudominio.com.br`) usada no smoke test |

**Pré-requisitos no VPS** (setup manual, uma vez — fora do escopo de um workflow de CI, é
provisionamento inicial do host): Docker + plugin Docker Compose, Node.js 24+, `git clone` do
repositório em `VPS_DEPLOY_DIR`, `.env` já populado (`chmod 600`). Node é necessário no host (não
só dentro dos containers) porque `prisma migrate deploy` e os scripts de grants/seed rodam no host
— `services/app/Dockerfile` não copia `scripts/` para a imagem de runtime (ver
`deployment-notes.md`).

**Rollback manual:** `ssh` no VPS, `git checkout <sha-anterior>` dentro de `VPS_DEPLOY_DIR`, depois
`./scripts/deploy.sh` novamente (builda a versão anterior localmente). Não há rollback automatizado
— para a escala atual (solo/dupla), um comando manual documentado é suficiente; automatizar isso
sem métricas de erro para decidir "quando" reverter seria construir metade de um sistema de
canary/rollback sem a outra metade (fora de escopo, SRE define isso se/quando fizer sentido).

## 5. Log shipping

Hoje os containers logam para stdout (`docker compose logs`), suficiente para acesso via SSH. Para
quando não houver acesso SSH constante assumido (ver discovery), `deploy/vector.toml.example`
documenta uma configuração mínima do [Vector](https://vector.dev) para encaminhar logs de todos os
containers do host para um agregador externo (Loki, Datadog, Elasticsearch, HTTP genérico — troque
o sink). **Não está habilitado por padrão** — nenhum serviço `vector` existe em
`docker-compose.prod.yml`; ativar exige escolher um destino real primeiro (decisão de time/
orçamento). Ver comentários no próprio arquivo para os passos de ativação.

Nota: `app`/`worker` hoje logam texto simples (`console.log`/`console.error`), não JSON
estruturado — a config de exemplo do Vector é defensiva quanto a isso (tenta parsear como JSON,
mantém texto puro quando não é). Logging estruturado é responsabilidade de BUILD/software-engineer
se/quando virar prioridade.

## 6. Monitoramento — hook de infraestrutura (SEM definir SLOs)

Esta passada **não** define SLOs, thresholds de alerta nem runbooks — isso é autoridade exclusiva
da passada de SRE (T9, roda depois desta). O que fica registrado aqui é só o ponto de extensão:

- Não existe hoje um endpoint `/api/metrics` (formato Prometheus) em `services/app` — quando SRE
  definir os SLIs relevantes, o lugar natural para esse endpoint é
  `services/app/src/app/api/metrics/route.ts` (mesmo padrão de `healthz`/`readyz`), instrumentado
  por software-engineer.
- Quando esse endpoint existir, o scrape config (`prometheus.yml`) e os dashboards/alerting ficam
  em `infrastructure/monitoring/` (convenção do skill de DevOps) — não criado nesta passada porque
  não há métricas reais para coletar ainda (criar a estrutura vazia seria decoração sem
  informação).
- `caddy` já expõe métricas Prometheus nativamente em sua admin API (`:2019/metrics`, não publicada
  ao host) — disponível para scraping interno assim que houver um Prometheus rodando na mesma rede
  Docker, sem configuração adicional do lado do Caddy.

## 7. Verificação desta passada

- `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` — **validado**, Docker
  29.8.0 / Compose v5.5.1 disponíveis neste ambiente de execução (diferente da passada anterior,
  que rodou sem Docker instalado). Confirmado por leitura do output renderizado: `app` sem chave
  `ports` (override para lista vazia funcionou — sem `!override` o Compose CONCATENA listas entre
  arquivos em vez de substituir, testado explicitamente nesta passada), `caddy` com `80/tcp`,
  `443/tcp`, `443/udp` e os dois volumes nomeados (`caddy_data`, `caddy_config`).
- `.github/workflows/cd-production.yml`, `ci.yml` e `test.yml` — **validado** sintaticamente
  (`yaml.safe_load` via container Python descartável, os três arquivos parseiam sem erro). Não foi
  possível validar a execução real do workflow (precisa de um VPS real, secrets configurados e um
  push/PR de fato — fora do alcance deste ambiente).
- `bash -n` em `scripts/backup-postgres.sh`, `restore-postgres.sh`, `rotate-secrets.sh`,
  `deploy.sh` — **validado**, todos sem erro de sintaxe. A lógica de conexão local via socket Unix
  do `pg_dump`/`psql` dentro do container (`docker compose exec`) segue o mesmo padrão de auth já
  usado implicitamente pela imagem oficial `postgres` neste projeto (sem
  `POSTGRES_HOST_AUTH_METHOD` customizado) — **não testado contra um Postgres real** neste
  ambiente (exigiria subir a stack completa e popular dados, fora do escopo desta revisão de
  infraestrutura).
- Todos os scripts (`.sh`) marcados executáveis (`chmod +x`).
- **Não verificado** (precisa de VPS real): emissão real de certificado TLS pelo Caddy (exige
  domínio público real + porta 80/443 acessível da internet), deploy SSH de ponta a ponta, e o
  smoke test contra uma URL pública de verdade.

## Histórico

Este documento substitui o placeholder de "O que falta para um deploy real em VPS" descrito em
`deployment-notes.md` (Wave A) — essa seção permanece lá como registro histórico do que foi
identificado como gap; aqui está a implementação.
