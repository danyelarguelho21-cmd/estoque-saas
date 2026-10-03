-- Endereço de cobrança do tenant (exigido pelo gateway Pix da Vindi). Colunas nullable para não
-- quebrar tenants existentes; os CHECKs só validam o formato quando o valor está preenchido.
ALTER TABLE "tenants"
  ADD COLUMN "billing_zipcode" TEXT,
  ADD COLUMN "billing_street" TEXT,
  ADD COLUMN "billing_number" TEXT,
  ADD COLUMN "billing_complement" TEXT,
  ADD COLUMN "billing_neighborhood" TEXT,
  ADD COLUMN "billing_city" TEXT,
  ADD COLUMN "billing_state" TEXT;

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_billing_zipcode_format" CHECK ("billing_zipcode" IS NULL OR "billing_zipcode" ~ '^[0-9]{8}$'),
  ADD CONSTRAINT "tenants_billing_state_format" CHECK ("billing_state" IS NULL OR "billing_state" ~ '^[A-Z]{2}$');
