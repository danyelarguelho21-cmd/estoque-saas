-- Fechamento de caixa diário por loja.
--
-- 1) sales.payment_method: forma de pagamento estruturada (lista fixa). Vendas antigas ficam com
--    NULL e continuam com o texto livre em payment_method_label (exibido como "Não informado"
--    quando nenhum dos dois existe).
-- 2) cash_sessions: um caixa (abertura -> fechamento) por loja. O índice único parcial garante no
--    banco que só existe UM caixa aberto por loja, mesmo com duas aberturas simultâneas.
--    Os valores calculados no fechamento (esperado, vendas por forma) ficam gravados como
--    "fotografia" — o histórico não muda se depois for lançada uma venda com data retroativa.
-- 3) cash_movements: sangrias (retirada) e suprimentos (entrada) de dinheiro durante o caixa.
--
-- RLS: as duas tabelas novas são tenant-scoped — habilita RLS + política tenant_isolation (mesmo
-- padrão de schemas/migrations/0008) e dá DML ao app_user (mesmo padrão de 0003). O GRANT é
-- condicional porque numa instalação do zero `prisma migrate deploy` roda ANTES de
-- apply-role-grants.mjs criar o app_user; nesse caso 0003 concede os mesmos privilégios depois.

ALTER TABLE "sales" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "sales" ADD CONSTRAINT "sales_payment_method_check"
    CHECK ("payment_method" IS NULL OR "payment_method" IN ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'outro'));
CREATE INDEX "sales_tenant_store_created_idx" ON "sales" ("tenant_id", "store_id", "created_at");

CREATE TABLE "cash_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "opening_amount_cents" INTEGER NOT NULL,
    "opened_by" UUID NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by" UUID,
    "closed_at" TIMESTAMP(3),
    "counted_cash_cents" INTEGER,
    "counted_pix_cents" INTEGER,
    "counted_debit_cents" INTEGER,
    "counted_credit_cents" INTEGER,
    "expected_cash_cents" INTEGER,
    "sales_total_cents" INTEGER,
    "sales_count" INTEGER,
    "summary" JSONB,
    "notes" TEXT,
    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cash_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cash_sessions_status_check" CHECK ("status" IN ('open', 'closed')),
    CONSTRAINT "cash_sessions_opening_amount_check" CHECK ("opening_amount_cents" >= 0)
);

CREATE UNIQUE INDEX "cash_sessions_one_open_per_store" ON "cash_sessions" ("tenant_id", "store_id") WHERE "status" = 'open';
CREATE INDEX "cash_sessions_tenant_store_opened_idx" ON "cash_sessions" ("tenant_id", "store_id", "opened_at");

CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "cash_session_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cash_movements_cash_session_id_fkey" FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cash_movements_type_check" CHECK ("type" IN ('sangria', 'suprimento')),
    CONSTRAINT "cash_movements_amount_check" CHECK ("amount_cents" > 0)
);

CREATE INDEX "cash_movements_session_idx" ON "cash_movements" ("cash_session_id");

ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_sessions" USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON "cash_movements" USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_sessions" TO app_user;
        GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_movements" TO app_user;
    END IF;
END $$;
