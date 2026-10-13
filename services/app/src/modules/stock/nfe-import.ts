import {
  assertWithinPlanLimit,
  ConflictError,
  NotFoundError,
  ValidationError,
  defaultFileStorage,
  recordAudit,
  withTenant,
  type FileStorage,
} from "@estoque-saas/shared";
import { getTenantWithPlan } from "@/modules/auth";
import { lockStockRow, nextBalanceAfter } from "./balance";
import { parseNfeXml } from "./nfe-parser";

export interface UploadNfeImportResult {
  importId: string;
}

// Liga ao item da NF-e um produto criado pelo operador durante a conferência. Criar o produto
// sem gravar matchedProductId deixava o item permanentemente unmatched e mantinha a confirmação
// da importação desabilitada.
export async function linkNfeImportItemToProduct(
  tenantId: string,
  importId: string,
  itemId: string,
  productId: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const nfeImport = await tx.nfeImport.findUnique({ where: { id: importId } });
    if (!nfeImport) throw new NotFoundError("Import de NF-e não encontrado.");
    if (nfeImport.status !== "pending_review") {
      throw new ValidationError(`Import não está em conferência (status atual: ${nfeImport.status}).`);
    }

    const item = await tx.nfeImportItem.findFirst({ where: { id: itemId, nfeImportId: importId } });
    if (!item) throw new NotFoundError("Item da NF-e não encontrado.");
    if (item.status !== "unmatched") throw new ConflictError("Este item já está vinculado a um produto.");

    const product = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new NotFoundError("Produto não encontrado.");

    await tx.nfeImportItem.update({
      where: { id: itemId },
      data: { matchedProductId: product.id, status: "created" },
    });
  });
}

export interface BulkCreateNfeProductsResult {
  created: number;
  linked: number;
}

// Cadastro em lote: cria (ou reaproveita) um produto para CADA item ainda "unmatched" da
// conferência, numa única transação. Reaproveita produto existente com o mesmo código de barras
// (ou mesmo SKU sem EAN conflitante) e deduplica itens repetidos dentro da própria nota. Respeita
// o limite de produtos do plano para o lote inteiro (tudo ou nada).
export async function bulkCreateProductsFromNfeImport(
  tenantId: string,
  userId: string,
  importId: string,
): Promise<BulkCreateNfeProductsResult> {
  const tenant = await getTenantWithPlan(tenantId);

  return withTenant(tenantId, async (tx) => {
    const nfeImport = await tx.nfeImport.findUnique({ where: { id: importId } });
    if (!nfeImport) throw new NotFoundError("Import de NF-e não encontrado.");
    if (nfeImport.status !== "pending_review") {
      throw new ValidationError(`Import não está em conferência (status atual: ${nfeImport.status}).`);
    }

    const items = await tx.nfeImportItem.findMany({
      where: { nfeImportId: importId, status: "unmatched" },
      orderBy: { id: "asc" },
    });
    if (items.length === 0) return { created: 0, linked: 0 };

    // Primeiro resolve o que já existe, para só contar no limite o que realmente será criado.
    const plan: Array<{ itemId: string; productId: string | null; key: string }> = [];
    const toCreate = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      const sku = item.cProd.trim();
      const key = item.cEAN ? `ean:${item.cEAN}` : sku ? `sku:${sku}` : `item:${item.id}`;
      let existingId: string | null = null;
      if (item.cEAN) {
        existingId = (await tx.product.findFirst({ where: { barcode: item.cEAN, deletedAt: null }, select: { id: true } }))?.id ?? null;
      } else if (sku) {
        existingId = (await tx.product.findFirst({ where: { sku, barcode: null, deletedAt: null }, select: { id: true } }))?.id ?? null;
      }
      plan.push({ itemId: item.id, productId: existingId, key });
      if (!existingId && !toCreate.has(key)) toCreate.set(key, item);
    }

    if (toCreate.size > 0) {
      const currentCount = await tx.product.count({ where: { deletedAt: null } });
      assertWithinPlanLimit(
        "products",
        currentCount,
        { maxProducts: tenant.plan.maxProducts, maxUsers: tenant.plan.maxUsers, maxStores: tenant.plan.maxStores },
        toCreate.size,
      );
    }

    const createdByKey = new Map<string, string>();
    for (const [key, item] of toCreate) {
      const desiredSku = item.cProd.trim() || null;
      // SKU é único por tenant: se já estiver em uso por outro produto, cadastra sem SKU.
      const skuTaken = desiredSku ? await tx.product.findFirst({ where: { sku: desiredSku }, select: { id: true } }) : null;
      const product = await tx.product.create({
        data: {
          tenantId,
          sku: skuTaken ? null : desiredSku,
          name: item.xProd.trim() || desiredSku || "Produto sem nome",
          unitOfMeasure: "UN",
          barcode: item.cEAN ?? null,
          supplierId: nfeImport.supplierId ?? null,
          costPriceCents: item.vUnComCents,
        },
      });
      await recordAudit(tx, {
        tenantId,
        userId,
        entityType: "product",
        entityId: product.id,
        action: "create",
        after: { sku: product.sku, name: product.name, source: "nfe_bulk", nfeImportId: importId },
      });
      createdByKey.set(key, product.id);
    }

    let linked = 0;
    for (const entry of plan) {
      const productId = entry.productId ?? createdByKey.get(entry.key);
      if (!productId) continue;
      await tx.nfeImportItem.update({
        where: { id: entry.itemId },
        data: { matchedProductId: productId, status: entry.productId ? "matched" : "created" },
      });
      linked++;
    }

    return { created: createdByKey.size, linked };
  });
}

// Upload de XML de NF-e (api/openapi/stock.yaml#uploadNfeImport). Apenas grava o arquivo + cria o
// registro em status pending_parse — o parsing em si acontece de forma assíncrona no job
// `parse-nfe` (ADR-005 — não bloquear a requisição HTTP com XMLs grandes).
export async function uploadNfeImport(
  tenantId: string,
  storeId: string,
  fileBuffer: Buffer,
  originalFileName: string,
  storage: FileStorage = defaultFileStorage,
): Promise<UploadNfeImportResult> {
  const fileRef = await storage.save(fileBuffer, originalFileName);
  const { id } = await withTenant(tenantId, (tx) =>
    tx.nfeImport.create({ data: { tenantId, storeId, fileRef, status: "pending_parse" } }),
  );
  return { importId: id };
}

// Processor do job `parse-nfe` (chamado pelo worker, ver src/worker/index.ts). Faz o parsing do
// XML e persiste nfe_import_items — NUNCA cria stock_movements/batches aqui (só confirmNfeImport
// faz isso, e só após confirmação explícita do operador — critério de aceite do BRD/ADR-005).
export async function processNfeImportJob(tenantId: string, importId: string, storage: FileStorage = defaultFileStorage): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const nfeImport = await tx.nfeImport.findUnique({ where: { id: importId } });
    if (!nfeImport) return;

    try {
      const xmlBuffer = await storage.read(nfeImport.fileRef);
      const parsed = parseNfeXml(xmlBuffer.toString("utf8"));

      let supplierId: string | null = nfeImport.supplierId;
      if (!supplierId && parsed.supplierCnpj) {
        const existingSupplier = await tx.supplier.findFirst({ where: { cnpj: parsed.supplierCnpj } });
        supplierId = existingSupplier?.id ?? (await tx.supplier.create({ data: { tenantId, name: parsed.supplierName ?? parsed.supplierCnpj, cnpj: parsed.supplierCnpj } })).id;
      }

      for (const item of parsed.items) {
        const matchedProduct = item.cEAN ? await tx.product.findFirst({ where: { barcode: item.cEAN, deletedAt: null } }) : null;
        await tx.nfeImportItem.create({
          data: {
            tenantId,
            nfeImportId: importId,
            cProd: item.cProd,
            cEAN: item.cEAN,
            xProd: item.xProd,
            ncm: item.ncm,
            qCom: item.qCom,
            vUnComCents: item.vUnComCents,
            matchedProductId: matchedProduct?.id ?? null,
            status: matchedProduct ? "matched" : "unmatched",
          },
        });
      }

      await tx.nfeImport.update({
        where: { id: importId },
        data: {
          status: "pending_review",
          accessKey: parsed.accessKey,
          supplierId,
        },
      });
    } catch (err) {
      // processNfeImportJob captura o erro aqui e nunca relança — por design (ADR-005: um XML
      // malformado não deve derrubar o worker nem re-tentar indefinidamente). Isso significa que
      // o BullMQ nunca emite "failed" pra esse job (worker/index.ts não loga nada) e a única
      // trilha de auditoria é a coluna errorMessage, que hoje nenhuma rota/tela expõe. Loga aqui
      // pra sempre existir um rastro operacional — achado testando o import de NF-e em dev (um
      // worker "fantasma" de uma execução anterior estava consumindo os jobs, mascarando o
      // comportamento real; sem esse log, teria sido bem mais difícil de diagnosticar).
      console.error(`[nfe-import ${importId}] falha ao processar:`, err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.error(err.stack);
      await tx.nfeImport.update({
        where: { id: importId },
        data: { status: "failed", errorMessage: err instanceof Error ? err.message : "Erro desconhecido ao processar XML." },
      });
    }
  });
}

export interface ConfirmNfeImportItemOverride {
  nfeImportItemId: string;
  batchNumber?: string | undefined;
  expiryDate?: string | undefined;
}

// Confirmação — SÓ AQUI stock_movements + batches + audit_log são gravados (critério de aceite do
// BRD: "nenhuma movimentação de estoque é criada até o operador confirmar explicitamente").
export async function confirmNfeImport(
  tenantId: string,
  userId: string,
  importId: string,
  itemOverrides: ConfirmNfeImportItemOverride[],
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const nfeImport = await tx.nfeImport.findUnique({ where: { id: importId }, include: { items: true } });
    if (!nfeImport) {
      throw new NotFoundError("Import de NF-e não encontrado.");
    }
    if (nfeImport.status === "confirmed") {
      throw new ConflictError("Este import já foi confirmado.");
    }
    if (nfeImport.status !== "pending_review") {
      throw new ValidationError(`Import não está pronto para confirmação (status atual: ${nfeImport.status}).`);
    }
    const stillUnmatched = nfeImport.items.some((i) => i.status === "unmatched");
    if (stillUnmatched) {
      throw new ConflictError("Ainda há itens não mapeados a um produto (unmatched).");
    }

    const overrideByItemId = new Map(itemOverrides.map((o) => [o.nfeImportItemId, o]));

    for (const item of nfeImport.items) {
      if (!item.matchedProductId) continue; // defensivo — já garantido pelo check acima
      const product = await tx.product.findUnique({ where: { id: item.matchedProductId } });
      if (!product) continue;

      await lockStockRow(tx, tenantId, product.id, nfeImport.storeId);

      const quantity = Math.round(Number(item.qCom));
      const override = overrideByItemId.get(item.id);

      let batchId: string | null = null;
      if (product.isPerishable && override?.batchNumber && override.expiryDate) {
        const batch = await tx.batch.create({
          data: {
            tenantId,
            productId: product.id,
            storeId: nfeImport.storeId,
            batchNumber: override.batchNumber,
            expiryDate: new Date(override.expiryDate),
            quantity,
          },
        });
        batchId = batch.id;
      }

      const balanceAfter = await nextBalanceAfter(tx, product.id, nfeImport.storeId, quantity);

      const movement = await tx.stockMovement.create({
        data: {
          tenantId,
          productId: product.id,
          storeId: nfeImport.storeId,
          batchId,
          type: "entrada_nfe",
          quantity,
          unitCostCents: item.vUnComCents,
          referenceId: importId,
          createdBy: userId,
          balanceAfter,
        },
      });

      await recordAudit(tx, {
        tenantId,
        userId,
        entityType: "stock_movement",
        entityId: movement.id,
        action: "create",
        after: { type: "entrada_nfe", productId: product.id, storeId: nfeImport.storeId, quantity, nfeImportId: importId },
      });
    }

    await tx.nfeImport.update({
      where: { id: importId },
      data: { status: "confirmed", confirmedBy: userId, confirmedAt: new Date() },
    });

    await recordAudit(tx, {
      tenantId,
      userId,
      entityType: "nfe_import",
      entityId: importId,
      action: "update",
      before: { status: "pending_review" },
      after: { status: "confirmed" },
    });
  });
}
