-- Senha (PIN) do gestor: libera faturamento/painel para o papel "vendedor" por tempo limitado.
-- Guardada só como hash bcrypt; nunca devolvida pela API (ver modules/auth/manager-pin.ts).
ALTER TABLE "tenants" ADD COLUMN "manager_pin_hash" TEXT;
