-- 0006_platform_admin_role.sql
-- estoque-saas — role dedicada para o painel administrativo interno do SaaS (modules/admin)
--
-- CONTEXTO: o painel do dono da plataforma (api/openapi/admin.yaml — listar tenants, suspender,
-- métricas de MRR/churn/inadimplência) precisa, por natureza, ler e agregar dados de TODOS os
-- tenants — isso é o oposto do isolamento por tenant que RLS/app_user garantem (0003) e é uma
-- exceção intencional (o dono do SaaS enxergando seus próprios assinantes), não uma falha de
-- isolamento. Em vez de dar BYPASSRLS para app_user (o que destruiria o isolamento para TODO o
-- resto do sistema), criamos uma terceira role, usada SOMENTE por
-- libs/shared/src/db/client.ts::platformAdminPrisma, que só o módulo admin importa.
--
-- Privilégio mínimo: BYPASSRLS é necessário (não há política de RLS que expresse "admin vê tudo"
-- sem enfraquecer a política tenant_isolation em si), mas os GRANTs abaixo ainda restringem a
-- role às tabelas que o painel realmente usa — não é um "segundo app_user".

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_admin_role') THEN
        CREATE ROLE platform_admin_role WITH LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '__PLATFORM_ADMIN_DB_PASSWORD__';
    ELSE
        ALTER ROLE platform_admin_role WITH LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '__PLATFORM_ADMIN_DB_PASSWORD__';
    END IF;
END $$;

GRANT CONNECT ON DATABASE estoque_saas TO platform_admin_role;
GRANT USAGE ON SCHEMA public TO platform_admin_role;

GRANT SELECT, UPDATE ON tenants TO platform_admin_role; -- listar + suspender/reativar (status)
GRANT SELECT ON subscriptions TO platform_admin_role; -- métricas (MRR, inadimplência)
GRANT SELECT ON invoices TO platform_admin_role; -- métricas (churn, faturas em atraso)
GRANT SELECT ON plans TO platform_admin_role; -- nome do plano na listagem de tenants
GRANT SELECT, INSERT, UPDATE ON platform_admins TO platform_admin_role; -- login do próprio admin
