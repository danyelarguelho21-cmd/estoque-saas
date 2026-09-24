// Módulo: catalog — produtos, categorias, fornecedores, import CSV.
// Fronteira: outros módulos e Route Handlers importam SOMENTE deste index.ts (ADR-001).
export {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  setProductStoreMinStock,
  prepareProductLabels,
  type ProductInput,
  type ProductUpdateInput,
  type ListProductsFilters,
} from "./products";
export { listCategories, createCategory } from "./categories";
export { listSuppliers, createSupplier, type SupplierInput, type ListSuppliersFilters } from "./suppliers";
export { parseProductsCsv, type CsvProductRow, type CsvParseResult } from "./csv-parser";
export { processProductsCsvJob } from "./csv-import";
