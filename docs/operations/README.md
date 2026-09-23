# Guia operacional — estoque-saas

Índice operacional. Cada seção resume o essencial e aponta para o documento canônico — este guia
não duplica conteúdo, para não divergir dele com o tempo.

## Deploy em produção

estoque-saas roda em um **VPS único via Docker Compose** (Caddy como reverse proxy/TLS automático,
app + worker + Postgres + Redis) — nenhuma dependência de nuvem específica, Kubernetes ou
Terraform (decisão de escala, ver [ADR-001](../architecture/architecture-decision-records/ADR-001-architecture-pattern.md)
e [ADR-003](../architecture/architecture-decision-records/ADR-003-tech-stack.md)).

```
Internet --HTTPS--> Caddy (80/443, TLS automático) --> app:3000 (rede interna Docker)
                                                            |
                                                     postgres / redis / worker
```

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

O CD (`.github/workflows/cd-production.yml`) dispara após o `ci.yml` passar em `main`, builda e
publica a imagem no GHCR (trilha de auditoria/rollback, não é o que roda em produção), faz deploy
via SSH (`scripts/deploy.sh`: `git pull` + `npm ci` + `prisma migrate deploy` + `docker compose up
-d --build`) e roda smoke test contra `/api/healthz`/`/api/readyz`. Rollback é manual
(`git checkout <sha> && ./scripts/deploy.sh`) — deliberadamente não automatizado nesta escala.

**Documento canônico e completo:** [production-deployment.md](../architecture/production-deployment.md)
(reverse proxy/TLS, CD, segredos do GitHub necessários, pré-requisitos do VPS, log shipping).
[deployment-notes.md](../architecture/deployment-notes.md) é o registro histórico da decisão original
(Wave A) — mantido como contexto, não como guia operacional ativo.

## Backup e restore do Postgres

- `scripts/backup-postgres.sh` — dump lógico (`pg_dump | gzip`), rotação por idade
  (`BACKUP_RETENTION_DAYS`, default 14 dias). Pensado para rodar via **cron do host** (exemplo em
  [production-deployment.md § 2](../architecture/production-deployment.md)), não como container
  sempre-ativo.
- `scripts/restore-postgres.sh <arquivo.sql.gz>` — operação destrutiva, pede confirmação
  interativa, para `app`/`worker` antes de aplicar o dump, reinicia depois.
- **Backups ficam em `./backups` no próprio VPS por padrão** — protege contra erro
  humano/corrupção lógica, **não** contra falha de disco/VPS inteiro. Configure
  `rclone`/`rsync`/`scp` periódico para outro destino (escolha de time/orçamento, não automatizado
  por padrão).

## Segredos em produção

`.env` local ao host (`chmod 600`, fora do controle de versão) — não um cofre dedicado
(Vault/AWS Secrets Manager), decisão deliberada para a escala atual (solo/dupla).

- `scripts/rotate-secrets.sh` gera novos valores (`AUTH_SECRET`, `PLATFORM_ADMIN_SESSION_SECRET`,
  senhas de banco) e imprime o passo a passo de rotação sem downtime. Para PagBank, a rotação é
  manual no painel do provedor.
- Cadência recomendada: **90 dias**, ou imediatamente após suspeita de vazamento.
- Ver [production-deployment.md § 3](../architecture/production-deployment.md) para o procedimento completo
  e a tabela de secrets do GitHub Actions necessários para o CD.

## Confiabilidade — SLOs e error budget

`Claude-Production-Grade-Suite/sre/slo/sli-definitions.yaml` define os SLOs; SRE é a autoridade
única sobre esses números (DevOps implementa o mecanismo de alerta, não os altera — ver
`.protocols/conflict-resolution.md`). Resumo dos alvos principais (30 dias):

| SLO | Alvo | Nota |
|---|---|---|
| Disponibilidade — caminhos críticos (auth, estoque, vendas, billing, admin RBAC) | 99.5% | ~3h36min de downtime permitido/mês — proporcional a VPS único, sem failover |
| Disponibilidade — dashboards/analytics | 99.0% | Tolerante a staleness por decisão de produto |
| Latência de leitura (GET) | p50 300ms / p95 1200ms | |
| Latência de escrita (POST/PUT/PATCH, dentro de transação RLS) | p50 400ms / p95 1500ms | |
| Alerta de estoque baixo (movimentação -> aparece na lista) | p95 60s | Critério de aceite do BRD, não só meta de SRE — breach é bug funcional |
| Ack do webhook PagBank | p95 2s / teto 5s | Ack rápido + reconciliação assíncrona, deliberado |
| Disponibilidade do webhook PagBank | 99.5% | Exaustão do budget congela feature work do módulo billing especificamente |

Política de orçamento de erro (resumo): budget < 50% no meio da janela -> priorizar trabalho de
confiabilidade no próximo sprint; budget esgotado -> congela novas features (exceto correções
emergenciais de billing/segurança) até voltar acima de 20%. Detalhes completos:
`Claude-Production-Grade-Suite/sre/slo/error-budget-policy.md` e `alerting-thresholds.md`.

Análise de capacidade, chaos engineering e game day playbook:
`Claude-Production-Grade-Suite/sre/capacity/` e `Claude-Production-Grade-Suite/sre/chaos/`.

## Runbooks de incidente

Fonte única de verdade operacional para resposta a incidentes — **não duplicados aqui**, apenas
indexados:

| Runbook | Quando usar |
|---|---|
| [disk-full-vps.md](../runbooks/disk-full-vps.md) | Disco cheio no VPS — Postgres pode começar a recusar escritas |
| [pagbank-webhook-processing-stopped.md](../runbooks/pagbank-webhook-processing-stopped.md) | Webhooks de pagamento pararam de processar / assinaturas travadas |
| [postgres-connection-pool-exhaustion.md](../runbooks/postgres-connection-pool-exhaustion.md) | Pool de conexões do Postgres perto de/esgotado |
| [postgres-rls-misconfiguration-cross-tenant-leak.md](../runbooks/postgres-rls-misconfiguration-cross-tenant-leak.md) | Suspeita de vazamento de dado entre tenants — SEV-1 sempre |
| [redis-unavailable.md](../runbooks/redis-unavailable.md) | Redis indisponível (fila de jobs + cache/sessão) |
| [stock-write-lock-contention.md](../runbooks/stock-write-lock-contention.md) | Latência de escrita de estoque disparando (contenção do advisory lock, ver CR-1) |
| [worker-queue-backlog-growing.md](../runbooks/worker-queue-backlog-growing.md) | Fila de imports de NF-e/alertas/cobrança acumulando |

Cada runbook documenta severidade, sintomas, diagnóstico e mitigação — abra o arquivo
correspondente durante um incidente real, não este índice.

## Monitoramento — estado atual

Não existe hoje um endpoint `/api/metrics` (Prometheus) nem dashboards/alerting configurados —
isso é um ponto de extensão documentado (ver
[production-deployment.md § 6](../architecture/production-deployment.md)), não uma capacidade
existente. `caddy` já expõe métricas Prometheus nativamente em sua admin API interna, disponível
para scraping assim que houver um Prometheus na mesma rede Docker.

## Próximos passos

- [production-deployment.md](../architecture/production-deployment.md) — procedimento completo de deploy.
- [Visão geral de arquitetura](../architecture/overview.md) — como os componentes se encaixam.
- [Guia do desenvolvedor](../guides/developer-guide.md) — ambiente local (diferente de produção).
