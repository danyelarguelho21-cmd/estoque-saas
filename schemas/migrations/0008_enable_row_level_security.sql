-- 0008_enable_row_level_security.sql
-- estoque-saas — habilita RLS + política tenant_isolation em TODAS as 21 tabelas tenant-scoped
--
-- ACHADO CRÍTICO (fase BUILD, verificado rodando um boot-smoke real contra Postgres real): a
-- migração que efetivamente cria as tabelas é a gerada por `prisma migrate dev` a partir de
-- schema.prisma — e a DSL do Prisma NÃO TEM CONCEITO de Row-Level Security. As instruções
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` só existiam em
-- 0001_init.sql/0002_remaining_tables.sql, que são apenas REFERÊNCIA — nunca foram de fato
-- executadas contra o banco real gerenciado por `prisma migrate`. Resultado: a aplicação inteira
-- rodava SEM isolamento de tenant algum — qualquer tenant conseguia ler/escrever dados de
-- qualquer outro. Confirmado empiricamente: um segundo tenant (signup) conseguia listar E ler por
-- ID um produto do primeiro tenant via /api/products.
--
-- Este arquivo é o que efetivamente corrige isso: roda (via scripts/apply-role-grants.mjs, mesma
-- infra de 0003-0007) DEPOIS de `prisma migrate deploy`, habilitando RLS nas 21 tabelas
-- tenant-scoped e criando a política tenant_isolation em cada uma. Idempotente (idempotência via
-- checagem em pg_policies antes de criar).

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
            'stock_alerts_config','notifications','audit_log'
        ])
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation'
        ) THEN
            IF t = 'tenants' THEN
                EXECUTE format(
                    'CREATE POLICY tenant_isolation ON %I USING (id = current_setting(''app.tenant_id'', true)::uuid)',
                    t
                );
            ELSE
                EXECUTE format(
                    'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
                    t
                );
            END IF;
        END IF;
    END LOOP;
END $$;
