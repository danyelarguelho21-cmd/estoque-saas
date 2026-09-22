-- 0002_remaining_tables.sql
-- estoque-saas — tabelas de estoque/vendas/nfe/transferências/notificações + RLS
-- Ver docs/architecture/architecture-decision-records/ADR-002-multi-tenancy-strategy.md
-- Espelha os models Prisma adicionados em libs/shared/prisma/schema.prisma
-- (StockMovement, NfeImport, NfeImportItem, Sale, SaleItem, Transfer, TransferItem, Notification).
--
-- NOTA: estas tabelas já existem em 0001_init.sql (criadas junto com o schema inicial completo,
-- ver ERD em schemas/erd.md). Esta migração é a que o Prisma efetivamente aplica para os models
-- adicionados na fase BUILD, mantendo o mesmo padrão de RLS de 0001. Se 0001 já rodou em um
-- ambiente (contém todas as 21 tabelas do ERD), esta migração é um no-op idempotente para essas
-- tabelas (usa IF NOT EXISTS / DO blocks defensivos) — existe para satisfazer o fluxo de migração
-- incremental do Prisma Migrate a partir do estado atual do schema.prisma versionado neste repo.

-- ============================================================
-- Movimentações de estoque
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_movements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    product_id      uuid NOT NULL REFERENCES products(id),
    store_id        uuid NOT NULL REFERENCES stores(id),
    batch_id        uuid REFERENCES batches(id),
    type            text NOT NULL CHECK (type IN (
                        'entrada_manual','entrada_nfe',
                        'saida_venda','saida_perda',
                        'transferencia_saida','transferencia_entrada',
                        'ajuste'
                    )),
    quantity        integer NOT NULL,
    unit_cost_cents integer,
    reference_id    uuid,
    created_by      uuid NOT NULL REFERENCES users(id),
    metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
    balance_after   integer NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_store ON stock_movements (tenant_id, product_id, store_id, created_at);

-- ============================================================
-- Importação de NF-e
-- ============================================================

CREATE TABLE IF NOT EXISTS nfe_imports (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    store_id        uuid NOT NULL REFERENCES stores(id),
    supplier_id     uuid REFERENCES suppliers(id),
    access_key      text,
    file_ref        text NOT NULL,
    status          text NOT NULL DEFAULT 'pending_parse' CHECK (status IN ('pending_parse','pending_review','confirmed','discarded','failed')),
    error_message   text,
    imported_at     timestamptz NOT NULL DEFAULT now(),
    confirmed_by    uuid REFERENCES users(id),
    confirmed_at    timestamptz
);

CREATE TABLE IF NOT EXISTS nfe_import_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    nfe_import_id       uuid NOT NULL REFERENCES nfe_imports(id),
    c_prod              text NOT NULL,
    c_ean               text,
    x_prod              text NOT NULL,
    ncm                 text,
    q_com               numeric(14,4) NOT NULL,
    v_un_com_cents      integer NOT NULL,
    matched_product_id  uuid REFERENCES products(id),
    status              text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('matched','unmatched','created'))
);

-- ============================================================
-- Vendas
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES tenants(id),
    store_id                uuid NOT NULL REFERENCES stores(id),
    customer_id             uuid REFERENCES customers(id),
    seller_id               uuid NOT NULL REFERENCES users(id),
    total_amount_cents      integer NOT NULL,
    payment_method_label    text,
    status                  text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','canceled')),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sale_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    sale_id             uuid NOT NULL REFERENCES sales(id),
    product_id          uuid NOT NULL REFERENCES products(id),
    batch_id            uuid REFERENCES batches(id),
    quantity            integer NOT NULL,
    unit_price_cents    integer NOT NULL
);

-- ============================================================
-- Transferências entre lojas
-- ============================================================

CREATE TABLE IF NOT EXISTS transfers (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES tenants(id),
    origin_store_id         uuid NOT NULL REFERENCES stores(id),
    destination_store_id    uuid NOT NULL REFERENCES stores(id),
    status                  text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','canceled')),
    created_by              uuid NOT NULL REFERENCES users(id),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfer_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    transfer_id     uuid NOT NULL REFERENCES transfers(id),
    product_id      uuid NOT NULL REFERENCES products(id),
    batch_id        uuid REFERENCES batches(id),
    quantity        integer NOT NULL
);

-- ============================================================
-- Notificações (alertas)
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    type        text NOT NULL CHECK (type IN ('low_stock','expiry','billing')),
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Row-Level Security (ADR-002) — mesmo padrão de 0001_init.sql,
-- aplicado apenas às tabelas desta migração (defensivo: pula tabelas
-- que já tenham a policy, para permitir reaplicação segura).
-- ============================================================

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY[
            'stock_movements','nfe_imports','nfe_import_items',
            'sales','sale_items','transfers','transfer_items','notifications'
        ])
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation'
        ) THEN
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
                t
            );
        END IF;
    END LOOP;
END $$;
