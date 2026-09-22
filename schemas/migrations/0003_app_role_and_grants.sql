-- 0003_app_role_and_grants.sql
-- estoque-saas — separação de role de aplicação (security-engineer finding C-1/C-2, fase BUILD)
--
-- PROBLEMA: docker-compose.yml / .env.example originalmente usavam uma única role Postgres
-- (POSTGRES_USER, ex: "estoque_app") para TUDO — migração E runtime da aplicação. A imagem oficial
-- `postgres` torna POSTGRES_USER um SUPERUSER do banco, e políticas de Row-Level Security NUNCA se
-- aplicam a superusers, independente de quão correto seja `withTenant()`/`set_config` na aplicação
-- (ver libs/shared/src/db/client.ts). Ou seja: a RLS estava, na prática, inerte.
--
-- SOLUÇÃO: duas roles distintas.
--   - Role administrativa (POSTGRES_USER original, ex: "estoque_app"): usada SOMENTE por
--     `prisma migrate` / DDL. Continua superuser (padrão da imagem postgres:*), o que é aceitável
--     pois só roda em contexto de migração administrada, nunca a partir de request HTTP.
--   - "app_user": nova role restrita, SEM BYPASSRLS (explícito, embora já seja o default para roles
--     não-superuser), com apenas os privilégios DML que a aplicação realmente precisa. É esta role
--     que `libs/shared/src/db/client.ts` usa em runtime (via APP_DATABASE_URL), tanto no processo
--     web (services/app) quanto no worker.
--
-- Este script é IDEMPOTENTE (pode rodar múltiplas vezes com segurança) e deve ser aplicado DEPOIS de
-- `prisma migrate deploy` (as tabelas precisam existir para os GRANTs). Ver Makefile (`make migrate`)
-- e scripts/apply-role-grants.mjs para a forma de aplicação (evita depender do cliente `psql` estar
-- instalado no container/host que roda a migração).
--
-- Parâmetro externo: a senha da role app_user é definida via variável de ambiente APP_DB_PASSWORD,
-- substituída por scripts/apply-role-grants.mjs antes de executar este SQL (o placeholder
-- '__APP_DB_PASSWORD__' abaixo nunca deve ser commitado com um valor real).

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '__APP_DB_PASSWORD__';
    ELSE
        ALTER ROLE app_user WITH LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '__APP_DB_PASSWORD__';
    END IF;
END $$;

GRANT CONNECT ON DATABASE estoque_saas TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

-- Tabelas globais (fora do RLS de tenant, ADR-002) — app_user precisa de DML normal.
GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admins TO app_user;

-- Tabelas tenant-scoped (RLS habilitada) — DML completo; o ISOLAMENTO entre tenants é garantido
-- pela política tenant_isolation (0001/0002), não pelos GRANTs em si.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY[
            'tenants','users','stores','subscriptions','invoices',
            'suppliers','categories','products','product_store_settings',
            'batches','stock_movements','nfe_imports','nfe_import_items',
            'customers','sales','sale_items','transfers','transfer_items',
            'stock_alerts_config','notifications'
        ])
    LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END LOOP;
END $$;

-- audit_log (ADR-007, C-2): imutabilidade reforçada em nível de banco — app_user pode
-- INSERT/SELECT, NUNCA UPDATE/DELETE. Isto é o "REVOKE" que estava comentado/não aplicado em
-- 0001_init.sql — agora real e efetivamente executado.
GRANT SELECT, INSERT ON audit_log TO app_user;
REVOKE UPDATE, DELETE ON audit_log FROM app_user;

-- Sequences/defaults: gen_random_uuid() não requer privilégio de sequence (pgcrypto function,
-- não serial) — nenhum GRANT adicional necessário para os defaults de PK deste schema.
