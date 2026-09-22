-- 0001_init.sql
-- estoque-saas — schema inicial (multi-tenant, schema compartilhado + RLS)
-- Ver docs/architecture/architecture-decision-records/ADR-002-multi-tenancy-strategy.md
--
-- NOTA (fase BUILD): este arquivo é a referência SQL "pura" do schema, mantida em sincronia manual
-- com libs/shared/prisma/schema.prisma. Em um ambiente real, `make migrate` roda `prisma migrate
-- dev|deploy`, que gera e aplica sua PRÓPRIA pasta de migração a partir do schema.prisma — essa é a
-- fonte que efetivamente cria as tabelas no banco. Este arquivo (+ 0002 e 0003) documenta o DDL
-- equivalente e é a fonte de verdade das políticas de RLS e separação de roles (Postgres RLS e
-- `CREATE ROLE`/`GRANT` não são expressáveis na DSL do Prisma) — 0003_app_role_and_grants.sql deve
-- ser aplicado manualmente (ou via script, ver Makefile) logo após o `prisma migrate deploy`, contra
-- o mesmo banco, para que a aplicação use uma role restrita (sem BYPASSRLS) em vez da role
-- administrativa usada pela migração.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- Tabelas globais (fora do RLS de tenant)
-- ============================================================

CREATE TABLE plans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    price_cents     integer NOT NULL,
    max_products    integer NOT NULL,
    max_users       integer NOT NULL,
    max_stores      integer NOT NULL,
    features        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_admins (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    email           text NOT NULL UNIQUE,
    password_hash   text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Tenants e núcleo
-- ============================================================

CREATE TABLE tenants (
    id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                            text NOT NULL,
    cnpj                            text NOT NULL UNIQUE,
    plan_id                         uuid NOT NULL REFERENCES plans(id),
    consolidated_stock              boolean NOT NULL DEFAULT false,
    perishable_tracking_enabled     boolean NOT NULL DEFAULT false,
    status                          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','canceled')),
    created_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    name            text NOT NULL,
    email           text NOT NULL,
    password_hash   text NOT NULL,
    role            text NOT NULL CHECK (role IN ('admin','operador','vendedor')),
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE stores (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    name        text NOT NULL,
    type        text NOT NULL DEFAULT 'loja' CHECK (type IN ('loja','deposito')),
    address     text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Cobrança (billing)
-- ============================================================

CREATE TABLE subscriptions (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   uuid NOT NULL REFERENCES tenants(id),
    plan_id                     uuid NOT NULL REFERENCES plans(id),
    status                      text NOT NULL CHECK (status IN ('trialing','active','past_due','canceled')),
    payment_method              text NOT NULL CHECK (payment_method IN ('card','pix_boleto')),
    gateway_customer_id         text,
    gateway_subscription_id     text,
    current_period_start        timestamptz,
    current_period_end          timestamptz,
    created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    subscription_id     uuid NOT NULL REFERENCES subscriptions(id),
    amount_cents        integer NOT NULL,
    status              text NOT NULL CHECK (status IN ('pending','paid','failed','overdue')),
    due_date            date NOT NULL,
    paid_at             timestamptz,
    payment_method      text NOT NULL CHECK (payment_method IN ('card','pix','boleto')),
    gateway_charge_id   text,
    gateway_event_id    text UNIQUE, -- chave de idempotência de webhook
    pix_qr_code         text,
    boleto_url          text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Catálogo
-- ============================================================

CREATE TABLE suppliers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    name        text NOT NULL,
    cnpj        text,
    contact     text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    name        text NOT NULL
);

CREATE TABLE products (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    sku                 text NOT NULL,
    name                text NOT NULL,
    category_id         uuid REFERENCES categories(id),
    unit_of_measure     text NOT NULL,
    barcode             text,
    supplier_id         uuid REFERENCES suppliers(id),
    is_perishable       boolean NOT NULL DEFAULT false,
    min_stock_global    integer NOT NULL DEFAULT 0,
    cost_price_cents    integer NOT NULL DEFAULT 0,
    sale_price_cents    integer NOT NULL DEFAULT 0,
    created_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    UNIQUE (tenant_id, sku)
);
CREATE INDEX idx_products_tenant_barcode ON products (tenant_id, barcode);

CREATE TABLE product_store_settings (
    tenant_id           uuid NOT NULL REFERENCES tenants(id), -- FIX (security-engineer C-3, BUILD phase):
                                                                -- coluna ausente na versão original quebrava
                                                                -- a política RLS de tenant_isolation abaixo
                                                                -- (referenciava tenant_id inexistente).
    product_id          uuid NOT NULL REFERENCES products(id),
    store_id            uuid NOT NULL REFERENCES stores(id),
    min_stock_override  integer,
    PRIMARY KEY (product_id, store_id)
);

-- ============================================================
-- Lotes (validade / FEFO)
-- ============================================================

CREATE TABLE batches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    product_id      uuid NOT NULL REFERENCES products(id),
    store_id        uuid NOT NULL REFERENCES stores(id),
    batch_number    text NOT NULL,
    expiry_date     date NOT NULL,
    quantity        integer NOT NULL DEFAULT 0,
    received_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_batches_product_store_expiry ON batches (product_id, store_id, expiry_date);

-- ============================================================
-- Movimentações de estoque (append-only por natureza de negócio)
-- ============================================================

CREATE TABLE stock_movements (
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
CREATE INDEX idx_stock_movements_product_store ON stock_movements (tenant_id, product_id, store_id, created_at);

-- ============================================================
-- Importação de NF-e
-- ============================================================

CREATE TABLE nfe_imports (
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

CREATE TABLE nfe_import_items (
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

CREATE TABLE customers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    name        text NOT NULL,
    document    text,
    phone       text,
    email       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales (
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

CREATE TABLE sale_items (
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

CREATE TABLE transfers (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES tenants(id),
    origin_store_id         uuid NOT NULL REFERENCES stores(id),
    destination_store_id    uuid NOT NULL REFERENCES stores(id),
    status                  text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','canceled')),
    created_by              uuid NOT NULL REFERENCES users(id),
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transfer_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    transfer_id     uuid NOT NULL REFERENCES transfers(id),
    product_id      uuid NOT NULL REFERENCES products(id),
    batch_id        uuid REFERENCES batches(id),
    quantity        integer NOT NULL
);

-- ============================================================
-- Alertas configuráveis
-- ============================================================

CREATE TABLE stock_alerts_config (
    tenant_id                  uuid PRIMARY KEY REFERENCES tenants(id),
    low_stock_alert_enabled    boolean NOT NULL DEFAULT true,
    expiry_alert_days          jsonb NOT NULL DEFAULT '[30,15,7]'::jsonb
);

CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenants(id),
    type        text NOT NULL CHECK (type IN ('low_stock','expiry','billing')),
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Auditoria imutável (ADR-007)
-- ============================================================

CREATE TABLE audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    user_id         uuid REFERENCES users(id),
    entity_type     text NOT NULL,
    entity_id       uuid NOT NULL,
    action          text NOT NULL CHECK (action IN ('create','update','delete')),
    before          jsonb,
    after           jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_tenant_entity ON audit_log (tenant_id, entity_type, entity_id);

-- ============================================================
-- Row-Level Security (ADR-002)
-- ============================================================

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
        -- tenants usa a própria coluna "id" como chave de tenant; as demais usam "tenant_id"
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
    END LOOP;
END $$;

-- audit_log: aplicação pode INSERT/SELECT, nunca UPDATE/DELETE (ADR-007).
-- Ajustar GRANTs conforme o usuário de aplicação criado no ambiente (ver docker-compose.yml / .env.example).
-- REVOKE UPDATE, DELETE ON audit_log FROM app_user;
