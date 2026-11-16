// Módulo: sales — vendas e clientes.
// Fronteira: outros módulos e Route Handlers importam SOMENTE deste index.ts (ADR-001).
export { createSale, listSales, getSale, type SaleInput, type SaleItemInput, type SaleResult, type ListSalesFilters } from "./sales";
export { listCustomers, createCustomer, getCustomerHistory, type CustomerInput, type ListCustomersFilters } from "./customers";
export { getAbcCurve, getStockTurnover, getStalledProducts, getBestSellers, getMonthlySalesSummary, getRevenueSummary, type DashboardDateFilter } from "./dashboard";
export {
  openCashSession,
  addCashMovement,
  closeCashSession,
  getCashSession,
  listOpenCashSessions,
  listClosedCashSessions,
  getTodayCashStatus,
  toCashSessionView,
  type CashSessionDetail,
  type CashSessionView,
  type CashMovementType,
} from "./cash-register";
export { computeCashSummary, computeCashDifferences, type CashSummary, type CashDifferences } from "./cash-summary";
