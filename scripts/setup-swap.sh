#!/usr/bin/env bash
# scripts/setup-swap.sh — cria um arquivo de swap no host do VPS, idempotente.
#
# Contexto: o tier de produção validado inicialmente é o plano DigitalOcean de $12/mês
# (1 vCPU / 2GB RAM, NYC1) — ver docker-compose.yml (mem_limit/cpus re-derivados em 2026-09-26)
# e docs/architecture/production-deployment.md. Com Postgres + app + worker + Caddy competindo
# por 2GB de RAM física, um swap serve como rede de segurança contra um pico de memória
# derrubar um container via OOM killer em vez de apenas degradar performance temporariamente.
# NÃO é um substituto para monitorar uso real de memória nem para migrar de tier se o uso
# sustentado ficar alto (ver "Como saber quando migrar de tier" em production-deployment.md).
#
# Uso (uma vez, no host, como root): sudo ./scripts/setup-swap.sh [tamanho_em_GB]
# Default: 2GB (dobra a RAM física do tier inicial — regra prática comum para hosts pequenos).

set -euo pipefail

SWAP_SIZE_GB="${1:-2}"
SWAP_FILE="/swapfile"

if swapon --show | grep -q "$SWAP_FILE"; then
  echo "[setup-swap] $SWAP_FILE já está ativo, nada a fazer."
  exit 0
fi

if [ -f "$SWAP_FILE" ]; then
  echo "[setup-swap] $SWAP_FILE já existe mas não está ativo — ativando."
else
  echo "[setup-swap] criando $SWAP_FILE de ${SWAP_SIZE_GB}GB"
  fallocate -l "${SWAP_SIZE_GB}G" "$SWAP_FILE" || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=$((SWAP_SIZE_GB * 1024))
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE"
fi

swapon "$SWAP_FILE"

if ! grep -q "^$SWAP_FILE " /etc/fstab; then
  echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  echo "[setup-swap] entrada adicionada em /etc/fstab (sobrevive a reboot)"
fi

# swappiness baixo: só usa o swap sob pressão real de memória, não por rotina — evita trocar
# páginas do Postgres/Node para disco desnecessariamente em uso normal.
sysctl -w vm.swappiness=10
if ! grep -q "^vm.swappiness" /etc/sysctl.conf 2>/dev/null; then
  echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

echo "[setup-swap] concluído:"
swapon --show
free -h
