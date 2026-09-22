"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FolderTree, Plus, Search, Truck, Upload } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSpinner } from "@/components/ui/spinner";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RoleGate } from "@/components/features/role-gate";
import { catalogApi } from "@/lib/api/catalog";
import { formatCentsToBRL } from "@/lib/format";

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [belowMinStock, setBelowMinStock] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const productsQuery = useQuery({
    queryKey: ["products", search, belowMinStock, cursor],
    queryFn: () => catalogApi.listProducts({ search: search || undefined, belowMinStock: belowMinStock || undefined, cursor, limit: 20 }),
  });

  function goNext() {
    if (!productsQuery.data?.page.next_cursor) return;
    setCursorHistory((h) => [...h, cursor ?? ""]);
    setCursor(productsQuery.data.page.next_cursor);
  }

  function goPrevious() {
    setCursorHistory((h) => {
      const next = [...h];
      const previous = next.pop();
      setCursor(previous || undefined);
      return next;
    });
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Produtos</h1>
            <p className="text-sm text-[var(--color-muted)]">Catálogo, categorias e fornecedores</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/produtos/categorias">
                <FolderTree className="h-4 w-4" />
                Categorias
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/produtos/fornecedores">
                <Truck className="h-4 w-4" />
                Fornecedores
              </Link>
            </Button>
            <RoleGate permission="catalog:manage">
              <Button asChild variant="outline">
                <Link href="/produtos/importar">
                  <Upload className="h-4 w-4" />
                  Importar CSV
                </Link>
              </Button>
              <Button asChild>
                <Link href="/produtos/novo">
                  <Plus className="h-4 w-4" />
                  Novo produto
                </Link>
              </Button>
            </RoleGate>
          </div>
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] p-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                placeholder="Buscar por nome, SKU ou código de barras"
                className="pl-9"
                value={search}
                onChange={(e) => {
                  setCursor(undefined);
                  setCursorHistory([]);
                  setSearch(e.target.value);
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={belowMinStock}
                onChange={(e) => {
                  setCursor(undefined);
                  setCursorHistory([]);
                  setBelowMinStock(e.target.checked);
                }}
                className="h-4 w-4 rounded border-[var(--color-border)]"
              />
              Só abaixo do mínimo
            </label>
          </div>

          {productsQuery.isLoading ? (
            <PageSpinner />
          ) : !productsQuery.data?.items.length ? (
            <EmptyState
              title="Nenhum produto encontrado"
              description="Cadastre seu primeiro produto ou ajuste os filtros de busca."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Estoque</TableHead>
                    <TableHead>Preço de venda</TableHead>
                    <TableHead>Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productsQuery.data.items.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                      <TableCell>
                        <Link href={`/produtos/${product.id}`} className="font-medium text-[var(--color-primary)] hover:underline">
                          {product.name}
                        </Link>
                      </TableCell>
                      <TableCell>{product.unitOfMeasure}</TableCell>
                      <TableCell>{product.currentStock ?? 0}</TableCell>
                      <TableCell>{formatCentsToBRL(product.salePriceCents)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {product.isPerishable && <Badge variant="info">Perecível</Badge>}
                          {(product.currentStock ?? 0) < (product.minStockGlobal ?? 0) && (
                            <Badge variant="danger">Estoque baixo</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                hasMore={productsQuery.data.page.has_more}
                onNext={goNext}
                onPrevious={goPrevious}
                canGoBack={cursorHistory.length > 0}
                loading={productsQuery.isFetching}
              />
            </>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
