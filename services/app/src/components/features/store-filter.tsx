"use client";

import { useQuery } from "@tanstack/react-query";
import { tenantsApi } from "@/lib/api/tenants";
import { Select } from "@/components/ui/select";

interface StoreFilterProps {
  value: string | undefined;
  onChange: (storeId: string | undefined) => void;
}

const ALL_STORES = "__all__";

/** Seletor de loja/depósito compartilhado entre Painel, Estoque e Vendas. */
export function StoreFilter({ value, onChange }: StoreFilterProps) {
  const storesQuery = useQuery({
    queryKey: ["stores"],
    queryFn: () => tenantsApi.listStores({ limit: 100 }),
  });

  const options = [
    { value: ALL_STORES, label: "Todas as lojas" },
    ...(storesQuery.data?.items.map((store) => ({ value: store.id, label: store.name })) ?? []),
  ];

  return (
    <Select
      value={value ?? ALL_STORES}
      onValueChange={(next) => onChange(next === ALL_STORES ? undefined : next)}
      options={options}
      aria-label="Filtrar por loja ou depósito"
    />
  );
}
