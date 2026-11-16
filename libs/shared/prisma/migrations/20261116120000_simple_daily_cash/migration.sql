-- Caixa do dia simplificado (substitui o caixa com abertura/sangria/suprimento de 20261109130000).
--
-- Não existe mais "abrir caixa": toda venda concluída entra no caixa do dia dela (fuso de MS) e o
-- fechamento grava uma "fotografia" do dia por loja em cash_closings (uma linha por loja + dia).
-- As tabelas cash_sessions/cash_movements foram criadas no mesmo dia e saem junto com a tela antiga.
-- sales.payment_method (forma de pagamento fixa) continua.

DROP TABLE IF EXISTS "cash_movements";
DROP TABLE IF EXISTS "cash_sessions";

CREATE TABLE "cash_closings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "sales_count" INTEGER NOT NULL,
    "sales_total_cents" INTEGER NOT NULL,
    "cost_total_cents" INTEGER NOT NULL,
    "by_method" JSONB NOT NULL,
    "notes" TEXT,
    "closed_by" UUID NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_closings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_closings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cash_closings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cash_closings_tenant_store_date_key" ON "cash_closings" ("tenant_id", "store_id", "business_date");

ALTER TABLE "cash_closings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cash_closings" USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_closings" TO app_user;
    END IF;
END $$;
