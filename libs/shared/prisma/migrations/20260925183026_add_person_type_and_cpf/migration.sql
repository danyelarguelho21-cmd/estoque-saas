/*
  Warnings:

  - A unique constraint covering the columns `[cpf]` on the table `tenants` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "person_type" TEXT NOT NULL DEFAULT 'PJ',
ALTER COLUMN "cnpj" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_cpf_key" ON "tenants"("cpf");
