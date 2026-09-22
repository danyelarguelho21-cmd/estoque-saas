/*
  Warnings:

  - The primary key for the `audit_log` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `user_id` column on the `audit_log` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `batches` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `categories` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `customers` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `invoices` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `nfe_import_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `matched_product_id` column on the `nfe_import_items` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `nfe_imports` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `supplier_id` column on the `nfe_imports` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `confirmed_by` column on the `nfe_imports` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `notifications` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `plans` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `platform_admins` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `product_store_settings` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `products` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `category_id` column on the `products` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `supplier_id` column on the `products` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `sale_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `batch_id` column on the `sale_items` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `sales` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `customer_id` column on the `sales` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `stock_alerts_config` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `stock_movements` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `batch_id` column on the `stock_movements` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `reference_id` column on the `stock_movements` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `stores` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `subscriptions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `suppliers` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `tenants` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `transfer_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `batch_id` column on the `transfer_items` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `transfers` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `audit_log` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `audit_log` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `entity_id` on the `audit_log` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `batches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `batches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `product_id` on the `batches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `store_id` on the `batches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `categories` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `categories` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `customers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `customers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `invoices` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `invoices` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `subscription_id` on the `invoices` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `nfe_import_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `nfe_import_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `nfe_import_id` on the `nfe_import_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `nfe_imports` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `nfe_imports` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `store_id` on the `nfe_imports` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `notifications` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `notifications` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `plans` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `platform_admins` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `product_store_settings` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `product_id` on the `product_store_settings` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `store_id` on the `product_store_settings` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `products` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `products` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `sale_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `sale_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `sale_id` on the `sale_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `product_id` on the `sale_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `sales` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `sales` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `store_id` on the `sales` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `seller_id` on the `sales` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `stock_alerts_config` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `stock_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `stock_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `product_id` on the `stock_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `store_id` on the `stock_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `created_by` on the `stock_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `stores` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `stores` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subscriptions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `subscriptions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `plan_id` on the `subscriptions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `suppliers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `suppliers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `tenants` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `plan_id` on the `tenants` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `transfer_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `transfer_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `transfer_id` on the `transfer_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `product_id` on the `transfer_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `transfers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `transfers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `origin_store_id` on the `transfers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `destination_store_id` on the `transfers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `created_by` on the `transfers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `users` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `tenant_id` on the `users` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "batches" DROP CONSTRAINT "batches_product_id_fkey";

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "customers" DROP CONSTRAINT "customers_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "nfe_import_items" DROP CONSTRAINT "nfe_import_items_nfe_import_id_fkey";

-- DropForeignKey
ALTER TABLE "product_store_settings" DROP CONSTRAINT "product_store_settings_product_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_supplier_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_sale_id_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_alerts_config" DROP CONSTRAINT "stock_alerts_config_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "stores" DROP CONSTRAINT "stores_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "transfer_items" DROP CONSTRAINT "transfer_items_transfer_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_fkey";

-- AlterTable
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "user_id",
ADD COLUMN     "user_id" UUID,
DROP COLUMN "entity_id",
ADD COLUMN     "entity_id" UUID NOT NULL,
ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "batches" DROP CONSTRAINT "batches_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "product_id",
ADD COLUMN     "product_id" UUID NOT NULL,
DROP COLUMN "store_id",
ADD COLUMN     "store_id" UUID NOT NULL,
ADD CONSTRAINT "batches_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "categories" DROP CONSTRAINT "categories_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "customers" DROP CONSTRAINT "customers_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "subscription_id",
ADD COLUMN     "subscription_id" UUID NOT NULL,
ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "nfe_import_items" DROP CONSTRAINT "nfe_import_items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "nfe_import_id",
ADD COLUMN     "nfe_import_id" UUID NOT NULL,
DROP COLUMN "matched_product_id",
ADD COLUMN     "matched_product_id" UUID,
ADD CONSTRAINT "nfe_import_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "nfe_imports" DROP CONSTRAINT "nfe_imports_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "store_id",
ADD COLUMN     "store_id" UUID NOT NULL,
DROP COLUMN "supplier_id",
ADD COLUMN     "supplier_id" UUID,
DROP COLUMN "confirmed_by",
ADD COLUMN     "confirmed_by" UUID,
ADD CONSTRAINT "nfe_imports_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "plans" DROP CONSTRAINT "plans_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "platform_admins" DROP CONSTRAINT "platform_admins_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "product_store_settings" DROP CONSTRAINT "product_store_settings_pkey",
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "product_id",
ADD COLUMN     "product_id" UUID NOT NULL,
DROP COLUMN "store_id",
ADD COLUMN     "store_id" UUID NOT NULL,
ADD CONSTRAINT "product_store_settings_pkey" PRIMARY KEY ("product_id", "store_id");

-- AlterTable
ALTER TABLE "products" DROP CONSTRAINT "products_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "category_id",
ADD COLUMN     "category_id" UUID,
DROP COLUMN "supplier_id",
ADD COLUMN     "supplier_id" UUID,
ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "sale_id",
ADD COLUMN     "sale_id" UUID NOT NULL,
DROP COLUMN "product_id",
ADD COLUMN     "product_id" UUID NOT NULL,
DROP COLUMN "batch_id",
ADD COLUMN     "batch_id" UUID,
ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "sales" DROP CONSTRAINT "sales_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "store_id",
ADD COLUMN     "store_id" UUID NOT NULL,
DROP COLUMN "customer_id",
ADD COLUMN     "customer_id" UUID,
DROP COLUMN "seller_id",
ADD COLUMN     "seller_id" UUID NOT NULL,
ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "stock_alerts_config" DROP CONSTRAINT "stock_alerts_config_pkey",
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD CONSTRAINT "stock_alerts_config_pkey" PRIMARY KEY ("tenant_id");

-- AlterTable
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "product_id",
ADD COLUMN     "product_id" UUID NOT NULL,
DROP COLUMN "store_id",
ADD COLUMN     "store_id" UUID NOT NULL,
DROP COLUMN "batch_id",
ADD COLUMN     "batch_id" UUID,
DROP COLUMN "reference_id",
ADD COLUMN     "reference_id" UUID,
DROP COLUMN "created_by",
ADD COLUMN     "created_by" UUID NOT NULL,
ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "stores" DROP CONSTRAINT "stores_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD CONSTRAINT "stores_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "plan_id",
ADD COLUMN     "plan_id" UUID NOT NULL,
ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "plan_id",
ADD COLUMN     "plan_id" UUID NOT NULL,
ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "transfer_items" DROP CONSTRAINT "transfer_items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "transfer_id",
ADD COLUMN     "transfer_id" UUID NOT NULL,
DROP COLUMN "product_id",
ADD COLUMN     "product_id" UUID NOT NULL,
DROP COLUMN "batch_id",
ADD COLUMN     "batch_id" UUID,
ADD CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
DROP COLUMN "origin_store_id",
ADD COLUMN     "origin_store_id" UUID NOT NULL,
DROP COLUMN "destination_store_id",
ADD COLUMN     "destination_store_id" UUID NOT NULL,
DROP COLUMN "created_by",
ADD COLUMN     "created_by" UUID NOT NULL,
ADD CONSTRAINT "transfers_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenant_id",
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_store_settings" ADD CONSTRAINT "product_store_settings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_nfe_import_id_fkey" FOREIGN KEY ("nfe_import_id") REFERENCES "nfe_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_alerts_config" ADD CONSTRAINT "stock_alerts_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
