# DevOps — SHIP (T7): reverse proxy/TLS, backup, segredos, CD, log shipping

Notas de trabalho desta passada. Ver `docs/architecture/production-deployment.md` para a versão
voltada ao time (o documento oficial/autoritativo) e `docs/architecture/deployment-notes.md`
(seção "Atualização — passada SHIP") para o registro de auditoria ligado à passada anterior (Wave
A / T4a). Este arquivo é só o registro de decisões desta passada específica.

## Escopo confirmado (do brief T7)

Alvo de deploy continua VPS genérico via Docker Compose — **não** Kubernetes/Terraform/cloud IaC
(ADR-001/ADR-003, `c4-container.md`). SRE (T9) roda DEPOIS desta passada e é quem define
SLOs/alerting/runbooks — não implementados aqui, só o hook de onde um `/api/metrics` viveria.

## Decisões tomadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Reverse proxy | Caddy (`caddy:2.11-alpine`) | TLS automático, config mínima — já era a recomendação registrada em `deployment-notes.md` (Wave A), confirmada aqui |
| Onde fica o proxy | Overlay `docker-compose.prod.yml`, não editar `docker-compose.yml` base | Mantém o compose de dev intacto (sem Caddy/TLS local); produção usa `-f docker-compose.yml -f docker-compose.prod.yml` |
| Publicação da porta `app` em prod | Removida (`ports: !override []`) | Só o Caddy fica exposto publicamente; testado que sem `!override` o Compose CONCATENA listas de portas entre arquivos em vez de substituir (validado com `docker compose config`) |
| Backup do Postgres | Script + cron do host, não um container sempre-ativo | Evita duplicar credenciais de banco em outro serviço; mais simples de auditar num VPS solo/dupla |
| Segredos | `.env` local ao host (chmod 600) + script de rotação, sem cofre dedicado | Decisão já tomada (ADR-001, escala atual) — script cobre a mecânica/cadência, que é alçada de DevOps |
| CD — onde builda a imagem que roda em produção | No próprio VPS (`git pull` + `docker compose up -d --build`), não pull de imagem do GHCR | Segue `deployment-notes.md` explicitamente ("rolling restart via `docker compose up -d --build`"); GHCR é só trilha de auditoria/rollback, evita precisar configurar auth de registry no VPS |
| Estratégia de deploy | Rolling restart simples | Blue-green/canário = over-engineering nesta escala (ADR-001, confirmado no brief) |
| Migração em produção | Novo script `prisma:migrate:deploy` (`prisma migrate deploy`) | `prisma:migrate` existente usa `migrate dev`, que é dev-only/pode promptear — não seguro para CD não-interativo. Script novo adicionado, `make migrate` local não foi tocado |
| Log shipping | Exemplo de config Vector, não habilitado por padrão | Sem destino de agregação escolhido pelo time ainda; ativar sem isso seria over-engineering |
| Monitoramento | Só documentação do hook (`/api/metrics` futuro) | SLOs são autoridade de SRE (T9) — não definidos aqui, conforme boundary do conflict-resolution protocol (sre vs devops) |

## Gap identificado, não corrigido aqui (fora da alçada desta passada)

`app`/`worker` logam texto simples (`console.log`/`console.error`), não JSON estruturado — a
config de exemplo do Vector (`deploy/vector.toml.example`) é defensiva quanto a isso, mas logging
estruturado de verdade é decisão de BUILD/software-engineer, não registrada como bloqueio aqui.

## Arquivos criados/modificados

- `docker-compose.prod.yml` (novo) — overlay de produção
- `deploy/Caddyfile` (novo)
- `deploy/vector.toml.example` (novo)
- `.github/workflows/cd-production.yml` (novo)
- `scripts/backup-postgres.sh`, `scripts/restore-postgres.sh`, `scripts/rotate-secrets.sh`,
  `scripts/deploy.sh` (novos, todos `chmod +x`)
- `libs/shared/package.json`, `package.json` (raiz) — script `prisma:migrate:deploy` adicionado
- `.env.example` — variáveis de produção documentadas (`DOMAIN`, `TLS_EMAIL`,
  `BACKUP_DIR`/`BACKUP_RETENTION_DAYS`, `LOG_AGGREGATOR_URL`), todas comentadas/opcionais
- `docs/architecture/production-deployment.md` (novo) — documento autoritativo desta passada
- `docs/architecture/deployment-notes.md` — apenso (não reescrito) com resumo + link

## Verificação

Docker 29.8.0 / Docker Compose v5.5.1 disponíveis neste ambiente (diferente da passada anterior,
T4a, que rodou sem Docker). Validado por execução real:

- `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` — sintaticamente válido;
  inspecionado o output renderizado (`app` sem `ports`, `caddy` com `80/tcp`+`443/tcp`+`443/udp` e
  os volumes `caddy_data`/`caddy_config`).
- Comportamento de merge do Compose para a chave `ports` testado explicitamente em arquivos
  descartáveis (`_test-base.yml`/`_test-override.yml`, removidos depois) — confirmado que sem
  `!override` as listas são concatenadas, não substituídas; com `!override` (usado no overlay
  real), a lista base é substituída como esperado.
- `.github/workflows/cd-production.yml`, `ci.yml`, `test.yml` — parseados com sucesso via
  `yaml.safe_load` (container Python descartável, `python:3.13-alpine` + `pyyaml`).
- `bash -n` em todos os 4 scripts novos — sem erro de sintaxe.

Não verificado (precisa de VPS real, fora do alcance deste ambiente): emissão real de certificado
TLS Let's Encrypt, execução real do workflow de CD (SSH/secrets reais), smoke test contra URL
pública real, e execução real de `pg_dump`/`psql` contra um Postgres populado (a lógica de auth
via socket Unix local dentro do container segue o padrão já implícito no `docker-compose.yml`
existente — sem `POSTGRES_HOST_AUTH_METHOD` customizado — mas não foi exercitada ponta a ponta).
