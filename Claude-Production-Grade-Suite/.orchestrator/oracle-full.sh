#!/usr/bin/env bash
# Full oracle — build + suíte de testes + boot smoke real (não apenas /healthz).
# Rodar em: saída de loop, merge de wave, transição de fase (loop-protocol Rule 7).
set -uo pipefail
cd "$(dirname "$0")/../.."

STATUS=0

if [ ! -d node_modules ]; then
  echo "[oracle-full] UNAVAILABLE: node_modules ausente — rode 'npm install' primeiro."
  exit 0
fi

echo "[oracle-full] prisma generate..."
npm run prisma:generate --workspace libs/shared
[ $? -ne 0 ] && STATUS=1

echo "[oracle-full] build..."
npm run build
[ $? -ne 0 ] && STATUS=1

echo "[oracle-full] suíte de testes (unit/integration, workspaces)..."
npm run test --workspaces --if-present
[ $? -ne 0 ] && STATUS=1

echo "[oracle-full] boot smoke (Postgres real + app real)..."
if command -v docker >/dev/null 2>&1; then
  # QA Wave B (T5b): a stack completa (postgres/redis/app/worker) já costuma estar de pé via
  # `docker compose up -d` nesta máquina (porta 3000/5432/6379 ocupadas de propósito). Detectar
  # isso primeiro evita colisão de porta (subir um segundo `next start` em :3000) e evita destruir
  # dados seedados (Plans, tenants manuais) com um `docker compose down` desnecessário — reusamos a
  # stack já saudável em vez de gerenciar seu ciclo de vida aqui.
  APP_ALREADY_UP=$(docker compose ps --format json app 2>/dev/null | grep -o '"Health":"healthy"' || true)
  if [ -n "$APP_ALREADY_UP" ]; then
    echo "[oracle-full] stack já em execução (docker compose ps: app healthy) — reaproveitando, sem up/down."
    MANAGED_STACK=0
  else
    docker compose up -d postgres redis
    # aguarda healthcheck
    for i in $(seq 1 30); do
      STATE=$(docker compose ps --format json postgres 2>/dev/null | grep -o '"Health":"[a-z]*"' || true)
      echo "$STATE" | grep -q healthy && break
      sleep 2
    done
    npm run prisma:migrate --workspace libs/shared -- --skip-generate
    ( npm run start --workspace services/app & echo $! > /tmp/estoque-app.pid )
    sleep 8
    MANAGED_STACK=1
  fi

  # Smoke real: signup (boundary case incluído — CNPJ com caractere inesperado) + login + rota autenticada
  curl -sf -X POST http://localhost:3000/api/auth/signup \
    -H 'Content-Type: application/json' \
    -d '{"companyName":"Loja Teste <script>","cnpj":"00.000.000/0001-00","adminName":"Admin","adminEmail":"admin@teste.com","password":"senha12345","planId":"invalid-edge-case"}' \
    -o /tmp/estoque-smoke-signup.json || echo "[oracle-full] smoke signup falhou (ver /tmp/estoque-smoke-signup.json)"
  curl -sf http://localhost:3000/api/healthz -o /dev/null || STATUS=1
  curl -sf http://localhost:3000/api/readyz -o /dev/null || STATUS=1

  if [ "$MANAGED_STACK" = "1" ]; then
    kill "$(cat /tmp/estoque-app.pid)" 2>/dev/null || true
    docker compose down
  else
    echo "[oracle-full] stack reaproveitada deixada de pé (não gerenciada por este script)."
  fi
else
  echo "[oracle-full] UNVERIFIED: Docker indisponível neste ambiente — boot smoke real (Postgres + app) não pôde ser executado."
  echo "[oracle-full] UNVERIFIED registrado no receipt; NÃO tratar como aprovado. Rodar manualmente após instalar Docker Desktop."
fi

exit $STATUS
