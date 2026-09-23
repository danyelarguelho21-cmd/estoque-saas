#!/usr/bin/env bash
# scripts/rotate-secrets.sh — gera novos valores para os segredos locais ao host (.env) e imprime
# os passos manuais necessários para cada um. NÃO edita .env automaticamente (evita sobrescrever
# valores em uso sem o operador revisar) — os valores são impressos para colar manualmente.
#
# Contexto (decisão do time, ver ADR-001 e docs/architecture/production-deployment.md): escala
# solo/dupla, single-VPS — segredos de produção vivem em .env no host com permissões restritas
# (chmod 600), não em um cofre dedicado (Vault/AWS Secrets Manager/etc), que seria
# over-engineering nesta escala. Este script cobre a mecânica/cadência de rotação, que É
# responsabilidade de DevOps.
set -euo pipefail

echo "== Rotação de segredos — estoque-saas =="
echo

echo "--- AUTH_SECRET (Auth.js/NextAuth — sessões de tenant, services/app) ---"
echo "Novo valor:"
openssl rand -base64 32
echo "Depois de colar em .env: docker compose up -d --build (recria app/worker). Isso invalida"
echo "TODAS as sessões ativas de todos os tenants — prefira rotacionar em janela de baixo uso."
echo

echo "--- PLATFORM_ADMIN_SESSION_SECRET (sessão do painel /admin interno) ---"
echo "Novo valor:"
openssl rand -base64 32
echo "Mesma observação acima — invalida sessões ativas do painel administrativo interno."
echo

echo "--- Senhas de banco (POSTGRES_PASSWORD / APP_DB_PASSWORD / PLATFORM_ADMIN_DB_PASSWORD) ---"
echo "Sugestões de novos valores:"
echo "  POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "  APP_DB_PASSWORD=$(openssl rand -base64 24)"
echo "  PLATFORM_ADMIN_DB_PASSWORD=$(openssl rand -base64 24)"
echo
echo "IMPORTANTE — ordem para rotacionar sem downtime de autenticação no banco:"
echo "  1. Troque a senha NA ROLE do Postgres primeiro (role != POSTGRES_PASSWORD da role admin —"
echo "     troque app_user/platform_admin_role/a role admin conforme o valor rotacionado; ver"
echo "     schemas/migrations/0003_app_role_and_grants.sql e 0006_platform_admin_role.sql):"
echo "       docker compose exec -T postgres psql -U \"\$POSTGRES_USER\" -d estoque_saas -c \\"
echo "         \"ALTER ROLE app_user WITH PASSWORD '<novo-APP_DB_PASSWORD>';\""
echo "  2. Só então atualize o valor correspondente em .env"
echo "  3. docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build"
echo "     (recria app/worker com a connection string nova — postgres NÃO é recriado, os dados"
echo "     continuam intactos, só a senha da role muda)"
echo

echo "--- PagBank/PagSeguro (PAGBANK_API_KEY / PAGBANK_WEBHOOK_SECRET, ADR-004) ---"
echo "Não pode ser gerado localmente — rotação acontece no painel do PagBank"
echo "(https://minhaconta.pagbank.com.br, seção de credenciais de API / Notificações)."
echo "Passos:"
echo "  1. Gere uma NOVA credencial no painel do PagBank (não revogue a antiga ainda)."
echo "  2. Atualize PAGBANK_API_KEY/PAGBANK_WEBHOOK_SECRET em .env e faça deploy."
echo "  3. Confirme que webhooks recentes de cobrança estão sendo aceitos com o novo segredo"
echo "     (ver módulo billing, services/app/src/modules/billing)."
echo "  4. Só então revogue a credencial antiga no painel do PagBank."
echo

echo "Cadência recomendada: rotacionar AUTH_SECRET e senhas de banco a cada 90 dias, ou"
echo "imediatamente após suspeita de vazamento (.env exposto em log, laptop de operador"
echo "comprometido, etc). Confirme 'chmod 600 .env' no host — ver"
echo "docs/architecture/production-deployment.md, seção 'Segredos'."
