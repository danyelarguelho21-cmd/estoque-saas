/**
 * Tipos derivados de api/openapi/*.yaml (fonte única de verdade dos contratos).
 * Mantenha em sincronia manual até que a geração automática de tipos seja adotada
 * (ver Claude-Production-Grade-Suite/frontend-engineer/01-analysis.md).
 */

export type Role = "admin" | "operador" | "vendedor";

export interface PageInfo {
  next_cursor: string | null;
  has_more: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: PageInfo;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  trace_id: string;
}

/* ---------- tenants.yaml ---------- */

export interface Tenant {
  id: string;
  name: string;
  cnpj: string;
  planId: string;
  consolidatedStock: boolean;
  perishableTrackingEnabled: boolean;
  status: "active" | "suspended" | "canceled";
}

export interface StoreInput {
  name: string;
  type: "loja" | "deposito";
  address?: string;
}

export interface Store extends StoreInput {
  id: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "disabled";
}

/* ---------- catalog.yaml ---------- */

export interface ProductInput {
  sku: string;
  name: string;
  categoryId?: string;
  unitOfMeasure: string;
  barcode?: string;
  supplierId?: string;
  isPerishable?: boolean;
  minStockGlobal?: number;
  costPriceCents?: number;
  salePriceCents?: number;
}

export interface Product extends ProductInput {
  id: string;
  currentStock?: number;
}

export interface Category {
  id: string;
  name: string;
}

export interface SupplierInput {
  name: string;
  cnpj?: string;
  contact?: string;
}

export interface Supplier extends SupplierInput {
  id: string;
}

/* ---------- stock.yaml ---------- */

export type StockMovementType =
  | "entrada_manual"
  | "entrada_nfe"
  | "saida_venda"
  | "saida_perda"
  | "transferencia_saida"
  | "transferencia_entrada"
  | "ajuste";

export interface StockMovement {
  id: string;
  productId: string;
  storeId: string;
  batchId: string | null;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  createdBy: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ManualEntryInput {
  productId: string;
  storeId: string;
  quantity: number;
  unitCostCents?: number;
  batchNumber?: string;
  expiryDate?: string;
}

export interface StockExitInput {
  productId: string;
  storeId: string;
  quantity: number;
  type: "saida_perda" | "ajuste";
  reason: string;
  batchId?: string;
}

export interface TransferItemInput {
  productId: string;
  batchId?: string;
  quantity: number;
}

export interface TransferInput {
  originStoreId: string;
  destinationStoreId: string;
  items: TransferItemInput[];
}

export interface Batch {
  id: string;
  productId: string;
  storeId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

export interface FefoSuggestionItem {
  batchId: string;
  expiryDate: string;
  quantity: number;
}

export interface FefoSuggestion {
  suggestions: FefoSuggestionItem[];
  fullyCovered: boolean;
}

export type NfeImportStatus = "pending_parse" | "pending_review" | "confirmed" | "discarded" | "failed";
export type NfeImportItemStatus = "matched" | "unmatched" | "created";

export interface NfeImportItem {
  id: string;
  cProd: string;
  cEAN: string | null;
  xProd: string;
  qCom: number;
  vUnComCents: number;
  matchedProductId: string | null;
  status: NfeImportItemStatus;
}

export interface NfeImport {
  id: string;
  status: NfeImportStatus;
  storeId: string;
  supplierId: string | null;
  items: NfeImportItem[];
}

export interface NfeConfirmItemInput {
  nfeImportItemId: string;
  batchNumber?: string;
  expiryDate?: string;
}

/* ---------- sales.yaml ---------- */

export interface SaleItemInput {
  productId: string;
  batchId?: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface SaleInput {
  storeId: string;
  customerId?: string | null;
  paymentMethodLabel?: string;
  items: SaleItemInput[];
}

export interface SaleItem {
  productId: string;
  batchId: string | null;
  quantity: number;
  unitPriceCents: number;
}

export interface Sale {
  id: string;
  storeId: string;
  customerId: string | null;
  sellerId: string;
  totalAmountCents: number;
  status: "completed" | "canceled";
  createdAt: string;
  items: SaleItem[];
}

// POST /api/sales's actual response shape (services/app/src/modules/sales/sales.ts's
// SaleResult) — NOT a full Sale object, just enough to redirect/confirm. Was previously
// mis-typed as `Sale` here, which let the caller read a non-existent `.id` field (real bug found
// via manual e2e testing: post-sale redirect went to /vendas/undefined).
export interface CreateSaleResult {
  saleId: string;
  totalAmountCents: number;
}

export interface CustomerInput {
  name: string;
  document?: string;
  phone?: string;
  email?: string;
}

export interface Customer extends CustomerInput {
  id: string;
}

/* ---------- dashboard.yaml ---------- */

export interface AbcCurveItem {
  productId: string;
  productName: string;
  value: number;
  cumulativePercentage: number;
  class: "A" | "B" | "C";
}

export interface TurnoverItem {
  id: string;
  name: string;
  turnoverRate: number;
}

export interface StalledProduct {
  productId: string;
  productName: string;
  lastMovementAt: string | null;
}

export interface BestSeller {
  productId: string;
  productName: string;
  quantitySold: number;
  revenueCents: number;
}

/* ---------- billing.yaml ---------- */

export interface Plan {
  id: string;
  name: "Básico" | "Pro" | "Enterprise";
  priceCents: number;
  maxProducts: number;
  maxUsers: number;
  maxStores: number;
  features?: Record<string, unknown>;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";
export type PaymentMethod = "card" | "pix_boleto";

export interface Subscription {
  id: string;
  planId: string;
  status: SubscriptionStatus;
  paymentMethod: PaymentMethod;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

export interface Invoice {
  id: string;
  amountCents: number;
  status: "pending" | "paid" | "failed" | "overdue";
  dueDate: string;
  paidAt: string | null;
  paymentMethod: "card" | "pix" | "boleto";
  pixQrCode: string | null;
  boletoUrl: string | null;
}

/* ---------- admin.yaml ---------- */

export interface TenantAdminSummary {
  id: string;
  name: string;
  cnpj: string;
  planName: string;
  subscriptionStatus: SubscriptionStatus;
  status: "active" | "suspended" | "canceled";
  createdAt: string;
}

export interface PlatformMetrics {
  mrrCents: number;
  activeTenantsCount: number;
  pastDueTenantsCount: number;
  churnRateLast30d: number;
  newTenantsLast30d: number;
}
