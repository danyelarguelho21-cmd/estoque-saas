-- 0005_billing_webhook_lookup_function.sql
-- estoque-saas — função de apoio ao webhook do PagBank (lookup cross-tenant por referência de gateway)
--
-- MESMO PROBLEMA de 0004 (login): o webhook de pagamento (/api/webhooks/pagbank) chega SEM
-- tenant_id — só temos gateway_charge_id (invoice) ou gateway_subscription_id (subscription) no
-- payload do PagBank. Com RLS + app_user sem BYPASSRLS, não há como fazer
-- `SELECT ... WHERE gateway_charge_id = $1` sem o contexto de tenant já setado.
--
-- Mesma solução: função SECURITY DEFINER estreita, só para esta finalidade, GRANT EXECUTE (não
-- GRANT SELECT amplo) para app_user.

CREATE OR REPLACE FUNCTION billing_lookup_tenant_by_gateway_ref(p_charge_id text, p_subscription_id text)
RETURNS TABLE (tenant_id uuid, invoice_id uuid, subscription_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT i.tenant_id, i.id, i.subscription_id
    FROM invoices i
    WHERE p_charge_id IS NOT NULL AND i.gateway_charge_id = p_charge_id
    UNION ALL
    SELECT s.tenant_id, NULL, s.id
    FROM subscriptions s
    WHERE p_subscription_id IS NOT NULL AND s.gateway_subscription_id = p_subscription_id;
$$;

REVOKE ALL ON FUNCTION billing_lookup_tenant_by_gateway_ref(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_lookup_tenant_by_gateway_ref(text, text) TO app_user;
