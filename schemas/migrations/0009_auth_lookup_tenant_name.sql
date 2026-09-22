-- 0009_auth_lookup_tenant_name.sql
-- Integration-seam fix (post Wave-A merge): the frontend session UI (sidebar header) shows the
-- current tenant's name, so `session.user.tenantName` must be populated. The session/JWT
-- callbacks in auth.config.ts only had tenantId/role available because auth_lookup_user_by_email
-- (0004) didn't return the tenant's name. RETURNS TABLE column lists cannot be changed via
-- CREATE OR REPLACE — drop and recreate.

DROP FUNCTION IF EXISTS auth_lookup_user_by_email(text);

CREATE FUNCTION auth_lookup_user_by_email(p_email text)
RETURNS TABLE (
    tenant_id       uuid,
    tenant_name     text,
    user_id         uuid,
    name            text,
    password_hash   text,
    role            text,
    status          text,
    tenant_status   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.tenant_id, t.name, u.id, u.name, u.password_hash, u.role, u.status, t.status
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE u.email = p_email;
$$;

REVOKE ALL ON FUNCTION auth_lookup_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(text) TO app_user;
