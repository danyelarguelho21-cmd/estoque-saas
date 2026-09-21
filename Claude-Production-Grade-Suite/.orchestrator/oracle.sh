#!/usr/bin/env bash
# Fast oracle — typecheck + lint. Alvo: <15s. Executar após CADA edição de código-fonte
# (loop-protocol Rule 7). Esta plataforma não tem hook PostToolUse nativo (ver
# .protocols/platform-adaptation.md) — agentes devem rodar este script manualmente após editar.
set -uo pipefail
cd "$(dirname "$0")/../.."

STATUS=0

if [ ! -d node_modules ]; then
  echo "[oracle] UNAVAILABLE: node_modules ausente — rode 'npm install' primeiro."
  exit 0
fi

echo "[oracle] typecheck (workspaces)..."
npm run typecheck --workspaces --if-present
[ $? -ne 0 ] && STATUS=1

echo "[oracle] lint (workspaces)..."
npm run lint --workspaces --if-present
[ $? -ne 0 ] && STATUS=1

exit $STATUS
