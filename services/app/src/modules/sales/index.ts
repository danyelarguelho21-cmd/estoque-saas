// Módulo: sales — vendas e clientes.
// Fronteira: outros módulos e Route Handlers importam SOMENTE deste index.ts (ADR-001).
export { createSale, listSales, getSale, type SaleInput, type SaleItemInput, type SaleResult, type ListSalesFilters } from "./sales";
export { listCustomers, createCustomer, getCustomerHistory, type CustomerInput, type ListCustomersFilters } from "./customers";
export { getAbcCurve, getStockTurnover, getStalledProducts, getBestSellers, getMonthlySalesSummary, type DashboardDateFilter } from "./dashboard";
