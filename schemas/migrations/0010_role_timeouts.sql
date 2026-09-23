-- 0010_role_timeouts.sql
-- estoque-saas — timeouts de conexão/transação por role (sre finding, T9b SHIP readiness review)
--
-- PROBLEMA: nenhuma role tinha statement_timeout/lock_timeout/idle_in_transaction_session_timeout
-- configurado (default do Postgres é "0" = desabilitado/sem limite para todos os três). Duas
-- consequências concretas encontradas nesta revisão:
--   1. Uma exceção não tratada entre lockStockRow() (CR-1, libs/shared/src/modules/stock/
--      balance.ts) e as escritas seguintes, se não corretamente envolvida no rollback do
--      `$transaction` do Prisma, pode deixar uma transação aberta segurando uma conexão E o
--      pg_advisory_xact_lock indefinidamente — idle_in_transaction_session_timeout mata isso.
--   2. O próprio pg_advisory_xact_lock do CR-1 pode bloquear indefinidamente sob contenção
--      patológica (muitos operadores no mesmo produto/loja ao mesmo tempo) — sem lock_timeout,
--      a requisição trava em vez de falhar de forma limpa e deixar o chamador tentar de novo.
--      Ver Claude-Production-Grade-Suite/sre/capacity/hi2-cr1-slo-impact-review.md para a análise
--      completa (achado mais acionável da revisão de prontidão do SHIP).
--
-- SOLUÇÃO: ALTER ROLE ... SET aplica o default para TODA nova sessão daquela role dali em diante
-- (idempotente — reaplica o mesmo valor se rodado de novo, sem efeito colateral). Valores vêm de
-- Claude-Production-Grade-Suite/sre/capacity/scaling-configs.yaml (SRE é a autoridade única sobre
-- estes thresholds, ver conflict-resolution.md).
--
-- Aplicado por scripts/apply-role-grants.mjs (produção/dev real, DEPOIS de 0003/0006 — as roles
-- precisam existir) e por tests/fixtures/db-test-helpers.ts (banco de teste efêmero).

ALTER ROLE app_user SET statement_timeout = '15s';
ALTER ROLE app_user SET lock_timeout = '5s';
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '30s';

ALTER ROLE platform_admin_role SET statement_timeout = '30s';
ALTER ROLE platform_admin_role SET lock_timeout = '5s';
ALTER ROLE platform_admin_role SET idle_in_transaction_session_timeout = '30s';
