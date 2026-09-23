#!/usr/bin/env bash
# scripts/restore-postgres.sh — restaura um backup gerado por scripts/backup-postgres.sh.
# Operação DESTRUTIVA — sobrescreve o banco atual. Uso:
#   ./scripts/restore-postgres.sh backups/estoque_saas-20260921-030000.sql.gz
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

FILE="${1:?Uso: ./scripts/restore-postgres.sh <arquivo .sql.gz>}"
[ -f "$FILE" ] || { echo "Arquivo não encontrado: $FILE" >&2; exit 1; }

# shellcheck disable=SC1091
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

POSTGRES_USER_NAME="${POSTGRES_USER:-estoque_app}"
POSTGRES_DB_NAME="${POSTGRES_DB:-estoque_saas}"
COMPOSE_FILES=(-f docker-compose.yml)
[ -f docker-compose.prod.yml ] && COMPOSE_FILES+=(-f docker-compose.prod.yml)

echo "ATENÇÃO: isto vai SOBRESCREVER o banco '$POSTGRES_DB_NAME' com o conteúdo de $FILE."
read -r -p "Digite 'restaurar' para confirmar: " confirm
[ "$confirm" = "restaurar" ] || { echo "Cancelado."; exit 1; }

echo "[restore] parando app/worker (evita escritas concorrentes durante o restore)..."
docker compose "${COMPOSE_FILES[@]}" stop app worker

echo "[restore] aplicando $FILE em '$POSTGRES_DB_NAME'..."
gunzip -c "$FILE" | docker compose "${COMPOSE_FILES[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME"

echo "[restore] reiniciando app/worker..."
docker compose "${COMPOSE_FILES[@]}" start app worker

echo "[restore] OK. Confirme /api/healthz e /api/readyz antes de liberar tráfego."
