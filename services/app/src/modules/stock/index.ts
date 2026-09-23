// Módulo: stock — entradas, saídas, transferências, NF-e, lotes/FEFO, alertas.
// Fronteira: outros módulos e Route Handlers importam SOMENTE deste index.ts (ADR-001).
export { suggestFefoBatches, type FefoBatchInput, type FefoSuggestionResult } from "./fefo";
export { getCurrentStock, getCurrentStockForProducts, lockStockRow } from "./balance";
export { resolveExitLines, type ResolvedExitLine } from "./resolve-batches";
export { createManualEntry, type ManualEntryInput, type ManualEntryResult } from "./entries";
export { createStockExit, type StockExitInput, type StockExitResult } from "./exits";
export { createTransfer, type TransferInput, type TransferItemInput, type TransferResult } from "./transfers";
export { parseNfeXml, type ParsedNfe, type ParsedNfeItem } from "./nfe-parser";
export {
  uploadNfeImport,
  processNfeImportJob,
  confirmNfeImport,
  type UploadNfeImportResult,
  type ConfirmNfeImportItemOverride,
} from "./nfe-import";
export { listLowStockAlerts, listExpiringBatches, type LowStockProduct, type ExpiringBatch } from "./alerts";
export { getNfeImport, listStockMovements } from "./queries";
export { scanExpiryAndLowStockAlerts } from "./expiry-scan";
