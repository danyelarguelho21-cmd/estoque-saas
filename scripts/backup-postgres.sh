#!/usr/bin/env bash
# scripts/backup-postgres.sh — backup diário do Postgres via pg_dump, pensado para um único VPS
# via Docker Compose (sem Postgres gerenciado — ver ADR-001 e
# docs/architecture/production-deployment.md).
#
# Uso recomendado: crontab do host (deliberadamente NÃO um container sempre-ativo dentro do
# Compose — evita duplicar credenciais de banco em outro serviço e é mais simples de auditar):
#   0 3 * * * cd /opt/estoque-saas && ./scripts/backup-postgres.sh >> /var/log/estoque-backup.log 2>&1
#
# Faz um dump lógico completo (todos os tenants — pg_dump por tenant não é necessário aqui, o
# backup é do banco inteiro) via `docker compose exec`, usando a role administrativa
# (POSTGRES_USER, a mesma usada por `prisma migrate deploy`). Não passa senha explicitamente: a
# imagem oficial `postgres` autentica conexões via socket Unix local (dentro do próprio container)
# como "trust" por padrão quando POSTGRES_HOST_AUTH_METHOD não foi definido — que é o caso deste
# projeto (ver docker-compose.yml) — então `pg_dump -U <user>` roda sem senha ao ser executado
# DENTRO do container via `exec`, mesmo a role exigindo senha para conexões TCP externas.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# shellcheck disable=SC1091
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
POSTGRES_USER_NAME="${POSTGRES_USER:-estoque_app}"
POSTGRES_DB_NAME="${POSTGRES_DB:-estoque_saas}"

COMPOSE_FILES=(-f docker-compose.yml)
[ -f docker-compose.prod.yml ] && COMPOSE_FILES+=(-f docker-compose.prod.yml)

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/estoque_saas-$timestamp.sql.gz"
tmp="$dest.tmp"

echo "[backup] $(date -u -Iseconds) iniciando pg_dump -> $dest"

if docker compose "${COMPOSE_FILES[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME" --no-owner --no-privileges \
  | gzip > "$tmp"; then
  mv "$tmp" "$dest"
  echo "[backup] $(date -u -Iseconds) concluído: $(du -h "$dest" | cut -f1)"
else
  echo "[backup] $(date -u -Iseconds) FALHOU — removendo arquivo parcial" >&2
  rm -f "$tmp"
  exit 1
fi

echo "[backup] removendo backups com mais de $RETENTION_DAYS dias em $BACKUP_DIR"
find "$BACKUP_DIR" -name '*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

echo "[backup] OK. LEMBRETE: copie $BACKUP_DIR periodicamente para um destino FORA deste VPS"
echo "  (rclone/rsync/scp para outro host, ou object storage) — um backup que só existe no mesmo"
echo "  disco do banco não protege contra falha de disco/VPS inteiro. Ver"
echo "  docs/architecture/production-deployment.md, seção 'Backup'."
