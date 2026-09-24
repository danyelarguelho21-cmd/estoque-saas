import { api, buildQuery } from "./client";
import type { Category, Paginated, Product, ProductInput, ProductLabel, Supplier, SupplierInput } from "./types";

export const catalogApi = {
  listProducts: (
    params: {
      cursor?: string | undefined;
      limit?: number | undefined;
      search?: string | undefined;
      belowMinStock?: boolean | undefined;
    } = {},
  ) =>
    api.get<Paginated<Product>>(`/api/products${buildQuery(params)}`),
  createProduct: (input: ProductInput) => api.post<Product>("/api/products", input),
  prepareLabels: (productIds: string[]) => api.post<ProductLabel[]>("/api/products/labels", { productIds }),
  getProduct: (productId: string) => api.get<Product>(`/api/products/${productId}`),
  updateProduct: (productId: string, input: ProductInput) =>
    api.patch<Product>(`/api/products/${productId}`, input),
  deleteProduct: (productId: string) => api.delete<void>(`/api/products/${productId}`),
  setProductStoreMinStock: (productId: string, storeId: string, minStockOverride: number) =>
    api.put<void>(`/api/products/${productId}/store-settings/${storeId}`, { minStockOverride }),
  importProductsCsv: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return api.post<{ importJobId: string }>("/api/products/import", form);
  },

  listCategories: () => api.get<Category[]>("/api/categories"),
  createCategory: (name: string) => api.post<Category>("/api/categories", { name }),

  listSuppliers: (params: { cursor?: string | undefined; limit?: number | undefined } = {}) =>
    api.get<Paginated<Supplier>>(`/api/suppliers${buildQuery(params)}`),
  createSupplier: (input: SupplierInput) => api.post<Supplier>("/api/suppliers", input),
};
