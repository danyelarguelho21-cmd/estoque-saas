import {
  ConflictError,
  NotFoundError,
  ValidationError,
  defaultFileStorage,
  recordAudit,
  withTenant,
  type FileStorage,
} from "@estoque-saas/shared";
import { nextBalanceAfter } from "./balance";
import { parseNfeXml } from "./nfe-parser";

export interface UploadNfeImportResult {
  importId: string;
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
