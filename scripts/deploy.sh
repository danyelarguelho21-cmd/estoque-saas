#!/usr/bin/env bash
# scripts/deploy.sh — executado NO VPS via SSH por .github/workflows/cd-production.yml
# (job `deploy`). Pode também ser rodado manualmente no host para reproduzir um deploy.
#
# Pressupostos do host (documentados em docs/architecture/production-deployment.md):
#   - repositório já clonado em $DEPLOY_DIR (remote configurado, HTTPS ou deploy key)
#   - Docker + plugin Docker Compose E Node.js 24+ instalados — Node é necessário aqui pelo mesmo
#     motivo do `make migrate` local (ver docs/architecture/deployment-notes.md, seção "Como
#     make up / make migrate funcionam hoje"): `prisma migrate deploy` e scripts/*.mjs rodam no
#     HOST, não dentro da imagem — services/app/Dockerfile não copia scripts/ para o runtime stage
#   - .env já presente no host, fora do controle de versão, permissões restritas (chmod 600)
#
# Este script builda a imagem diretamente no VPS a partir do commit testado (fetch + detached checkout +
# `docker compose up -d --build`) — rolling restart simples, adequado a um único VPS
# (docs/architecture/deployment-notes.md: "blue-green/canário são over-engineering para a escala
# atual", ADR-001). O workflow de CD também builda e publica uma imagem no GHCR antes de chamar
# este script, mas SÓ para trilha de auditoria/rollback manual — não é essa imagem publicada que
# roda em produção (ver comentário no job build-and-push de cd-production.yml).
set -euo pipefail

DEPLOY_REF="${DEPLOY_REF:-main}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "[deploy] validando .env antes de alterar o checkout ou o banco"
node --env-file=.env scripts/validate-production-env.mjs

echo "[deploy] git fetch/checkout $DEPLOY_REF"
git fetch --prune origin
if git show-ref --verify --quiet "refs/remotes/origin/$DEPLOY_REF"; then
  CHECKOUT_REF="origin/$DEPLOY_REF"
else
  CHECKOUT_REF="$DEPLOY_REF"
fi
git checkout --detach "$CHECKOUT_REF"

echo "[deploy] npm ci"
npm ci

echo "[deploy] prisma generate"
npm run prisma:generate

echo "[deploy] prisma migrate deploy (não-interativo — 'migrate dev' é só para desenvolvimento)"
npm run prisma:migrate:deploy

echo "[deploy] grants de role + seed de planos (idempotentes — ver cabeçalho de cada script)"
node --env-file=.env scripts/apply-role-grants.mjs
node --env-file=.env scripts/seed-plans.mjs
node --env-file=.env scripts/bootstrap-platform-admin.mjs

echo "[deploy] docker compose up -d --build (rolling restart — postgres/redis não são recriados,"
echo "         só app/worker/caddy sobem com a imagem nova se o código mudou)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo "[deploy] concluído: $(git rev-parse --short HEAD)"
