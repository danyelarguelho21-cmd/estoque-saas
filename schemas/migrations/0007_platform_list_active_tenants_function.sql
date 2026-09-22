-- 0007_platform_list_active_tenants_function.sql
-- estoque-saas — função de apoio aos jobs de worker que varrem TODOS os tenants
--
-- CONTEXTO: os jobs `generate-monthly-charge` e `scan-expiry-alerts` (services/app/src/worker)
-- rodam sem uma requisição HTTP/sessão associada — não há "tenant atual". Mas por natureza
-- precisam enumerar todos os tenants ativos para, um a um, abrir um contexto RLS normal
-- (withTenant(tenantId, ...)) e processar cada tenant isoladamente. Mesma classe de problema de
-- 0004/0005 (login, webhook): função SECURITY DEFINER estreita — aqui devolve SOMENTE o id do
-- tenant (nada de dados de negócio), o mínimo necessário para o loop dos jobs.

CREATE OR REPLACE FUNCTION platform_list_active_tenant_ids()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM tenants WHERE status = 'active';
$$;

REVOKE ALL ON FUNCTION platform_list_active_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_list_active_tenant_ids() TO app_user;
