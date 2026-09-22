"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { catalogApi } from "@/lib/api/catalog";
import type { Product } from "@/lib/api/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ProductPickerProps {
  id?: string;
  selected: Product | null;
  onSelect: (product: Product) => void;
  onClear?: () => void;
}

/**
 * Busca de produto simplificada (não é um combobox ARIA completo) — input de texto com
 * debounce + lista de resultados clicável. Usado em entrada/saída/transferência/venda.
 */
export function ProductPicker({ id, selected, onSelect, onClear }: ProductPickerProps) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const searchQuery = useQuery({
    queryKey: ["products", "picker", debounced],
    queryFn: () => catalogApi.listProducts({ search: debounced, limit: 10 }),
    enabled: open && debounced.length > 0,
  });

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm">
        <div>
          <p className="font-medium text-slate-900">{selected.name}</p>
          <p className="text-xs text-[var(--color-muted)]">SKU {selected.sku}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setTerm("");
            onClear?.();
          }}
          aria-label="Trocar produto selecionado"
          className="text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <Input
          id={id}
          className="pl-9"
          placeholder="Buscar produto por nome, SKU ou código de barras"
          value={term}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && debounced.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-[var(--color-border)] bg-white shadow-lg"
        >
          {searchQuery.isLoading && <li className="px-3 py-2 text-sm text-slate-400">Buscando…</li>}
          {!searchQuery.isLoading && !searchQuery.data?.items.length && (
            <li className="px-3 py-2 text-sm text-slate-400">Nenhum produto encontrado</li>
          )}
          {searchQuery.data?.items.map((product) => (
            <li key={product.id} role="option" aria-selected={false}>
              <button
                type="button"
                className={cn(
                  "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-100",
                )}
                onClick={() => {
                  onSelect(product);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-slate-900">{product.name}</span>
                <span className="text-xs text-[var(--color-muted)]">
                  SKU {product.sku} · Estoque atual: {product.currentStock ?? 0}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
