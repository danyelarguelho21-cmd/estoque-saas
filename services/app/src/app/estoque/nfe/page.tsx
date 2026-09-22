"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { FileDrop } from "@/components/features/file-drop";
import { stockApi } from "@/lib/api/stock";
import { tenantsApi } from "@/lib/api/tenants";

/**
 * NOTA: api/openapi/stock.yaml não define um endpoint de listagem de imports de NF-e
 * (apenas POST /api/nfe-imports e GET /api/nfe-imports/{id}) — por isso esta tela é só o
 * upload; após o envio, o operador é redirecionado direto para a tela de conferência
 * (/estoque/nfe/[importId]), que é onde o histórico de status desse import específico vive.
 */
export default function NfeImportPage() {
  const router = useRouter();
  const storesQuery = useQuery({ queryKey: ["stores"], queryFn: () => tenantsApi.listStores({ limit: 100 }) });

  const [storeId, setStoreId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!storeId) {
      setError("Selecione a loja/depósito de destino antes de enviar o XML.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const result = await stockApi.uploadNfeImport(file, storeId);
      router.push(`/estoque/nfe/${result.importId}`);
    } catch {
      setError("Não foi possível enviar o XML. Verifique o arquivo e tente novamente.");
      setUploading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Importar NF-e do fornecedor</h1>
          <p className="text-sm text-[var(--color-muted)]">
            O XML é processado em segundo plano. Nenhuma movimentação de estoque é criada até você
            revisar e confirmar a importação na próxima tela.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upload do XML</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="danger" title="Não foi possível enviar">
                {error}
              </Alert>
            )}

            <Field label="Loja/depósito de destino" htmlFor="storeId" required>
              <Select
                id="storeId"
                value={storeId || undefined}
                onValueChange={setStoreId}
                options={(storesQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Selecione a loja"
              />
            </Field>

            <FileDrop
              accept=".xml,text/xml,application/xml"
              label="Arraste o XML da NF-e ou clique para selecionar"
              hint="Schema padrão SEFAZ (nfeProc/procNFe)"
              onFileSelected={handleFile}
              disabled={uploading || !storeId}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
