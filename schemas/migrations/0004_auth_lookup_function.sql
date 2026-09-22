-- 0004_auth_lookup_function.sql
-- estoque-saas — função de apoio ao login (lookup cross-tenant por e-mail)
--
-- PROBLEMA: /api/auth/login (api/openapi/auth.yaml) recebe apenas {email, password} — sem
-- tenantId — porque o usuário não sabe (nem deveria precisar saber) o id do seu tenant para logar.
-- Mas com RLS habilitada (ADR-002) e app_user SEM BYPASSRLS (0003, finding C-1), uma query comum
-- `SELECT * FROM users WHERE email = $1` com app.tenant_id ainda não setado (current_setting(...,
-- true) = NULL) não retorna NADA — a política tenant_isolation exige tenant_id = NULL, que nunca é
-- verdadeiro. É o comportamento correto e desejado para todo o resto do sistema (fail-safe), mas
-- inviabiliza literalmente o primeiro passo do login (ainda não sabemos o tenant).
--
-- SOLUÇÃO: uma função SECURITY DEFINER estreita, dona da role administrativa (portanto executa com
-- os privilégios dela, ignorando RLS internamente), que expõe SOMENTE os campos estritamente
-- necessários para autenticar (tenant_id, user_id, password_hash, role, status) e SOMENTE por
-- e-mail exato — nenhuma outra coluna, nenhum SELECT genérico. GRANT EXECUTE (não GRANT SELECT
-- direto na tabela) para app_user — a superfície de bypass de RLS fica restrita a esta única
-- operação, auditável e de propósito único, em vez de uma concessão ampla.
--
-- Se o e-mail existir em mais de um tenant (caso raro, mas possível — email é único apenas por
-- (tenant_id, email), não globalmente), a função retorna todas as correspondências; a camada de
-- aplicação (modules/auth) decide (hoje: tenta autenticar contra cada uma até achar a senha
-- correta — mesmo comportamento de "e-mail pode repetir entre empresas distintas").

CREATE OR REPLACE FUNCTION auth_lookup_user_by_email(p_email text)
RETURNS TABLE (
    tenant_id       uuid,
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
    SELECT u.tenant_id, u.id, u.name, u.password_hash, u.role, u.status, t.status
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE u.email = p_email;
$$;

REVOKE ALL ON FUNCTION auth_lookup_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(text) TO app_user;
